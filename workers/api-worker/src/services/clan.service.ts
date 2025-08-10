// workers/api-worker/src/services/clan.service.ts

import { nanoid } from 'nanoid';
import type { D1Database } from '@cloudflare/workers-types';

export interface Clan {
  id: string;
  name: string;
  displayName: string;
  description: string;
  avatar?: string;
  banner?: string;
  theme?: {
    primaryColor: string;
    secondaryColor: string;
    accentColor: string;
  };
  founder_id: string;
  founder?: {
    id: string;
    username: string;
    profile_image?: string;
  };
  member_count: number;
  is_active: boolean;
  is_private?: boolean;
  categories?: string[];
  rules?: Array<{ title: string; description: string }>;
  created_at: string;
  updated_at: string;
  
  // Computed fields
  isMember?: boolean;
  userRole?: string;
  stats?: ClanStats;
}

export interface ClanMember {
  user_id: string;
  username?: string;
  profile_image?: string;
  role: 'founder' | 'admin' | 'moderator' | 'member';
  joined_at: string;
}

export interface ClanStats {
  totalPosts: number;
  postsToday: number;
  activeMembers: number;
  growthRate: number;
  engagementRate: number;
}

interface ListClansOptions {
  page: number;
  limit: number;
  category?: string;
  search?: string;
  sortBy?: string;
  userId?: string;
}

export class ClanService {
  constructor(
    private db: D1Database,
    private cache: KVNamespace
  ) {}

  async createClan(founderId: string, data: any): Promise<Clan> {
    const clanId = nanoid();
    
    // Start transaction
    const statements = [];
    
    // Insert clan
    statements.push(
      this.db.prepare(`
        INSERT INTO clans (
          id, name, description, avatar_url, founder_id,
          member_count, is_active, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 1, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `).bind(
        clanId,
        data.name.toLowerCase(),
        data.description,
        data.avatar || null,
        founderId
      )
    );
    
    // Add founder as first member
    statements.push(
      this.db.prepare(`
        INSERT INTO clan_members (clan_id, user_id, role, joined_at)
        VALUES (?, ?, 'founder', CURRENT_TIMESTAMP)
      `).bind(clanId, founderId)
    );
    
    // Execute transaction
    await this.db.batch(statements);
    
    // Store additional metadata in KV if needed
    if (data.displayName || data.banner || data.categories || data.rules) {
      await this.cache.put(
        `clan:meta:${clanId}`,
        JSON.stringify({
          displayName: data.displayName || data.name,
          banner: data.banner,
          isPrivate: data.isPrivate || false,
          categories: data.categories || [],
          rules: data.rules || [],
          theme: data.theme
        }),
        { expirationTtl: 86400 } // 24 hours
      );
    }
    
    // Clear relevant caches
    await this.invalidateClanCaches(founderId);
    
    return this.getClanDetails(clanId, founderId) as Promise<Clan>;
  }

  async getClanDetails(clanId: string, userId?: string): Promise<Clan | null> {
    // Try cache first
    const cacheKey = `clan:${clanId}:${userId || 'public'}`;
    const cached = await this.cache.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }
    
    // Get clan from database
    const clan = await this.db.prepare(`
      SELECT 
        c.*,
        u.username as founder_username,
        u.profile_image as founder_profile_image
      FROM clans c
      JOIN users u ON c.founder_id = u.id
      WHERE c.id = ?
    `).bind(clanId).first();
    
    if (!clan) {
      return null;
    }
    
    // Get metadata from KV
    const metadataStr = await this.cache.get(`clan:meta:${clanId}`);
    const metadata = metadataStr ? JSON.parse(metadataStr) : {};
    
    // Check if user is member
    let isMember = false;
    let userRole = null;
    
    if (userId) {
      const membership = await this.db.prepare(`
        SELECT role FROM clan_members 
        WHERE clan_id = ? AND user_id = ?
      `).bind(clanId, userId).first();
      
      if (membership) {
        isMember = true;
        userRole = membership.role as string;
      }
    }
    
    // Get stats
    const stats = await this.getClanStats(clanId, 'day');
    
    const clanData: Clan = {
      id: clan.id as string,
      name: clan.name as string,
      displayName: metadata.displayName || clan.name as string,
      description: clan.description as string,
      avatar: clan.avatar_url as string || undefined,
      banner: metadata.banner,
      theme: metadata.theme,
      founder_id: clan.founder_id as string,
      founder: {
        id: clan.founder_id as string,
        username: clan.founder_username as string,
        profile_image: clan.founder_profile_image as string || undefined
      },
      member_count: clan.member_count as number,
      is_active: clan.is_active as boolean,
      is_private: metadata.isPrivate || false,
      categories: metadata.categories || [],
      rules: metadata.rules || [],
      created_at: clan.created_at as string,
      updated_at: clan.updated_at as string,
      isMember,
      userRole: userRole || undefined,
      stats
    };
    
    // Cache the result
    await this.cache.put(cacheKey, JSON.stringify(clanData), {
      expirationTtl: 300 // 5 minutes
    });
    
    return clanData;
  }

  async updateClan(clanId: string, data: any): Promise<Clan> {
    // Update database fields
    const updates = [];
    const params = [];
    
    if (data.description !== undefined) {
      updates.push('description = ?');
      params.push(data.description);
    }
    
    if (data.avatar !== undefined) {
      updates.push('avatar_url = ?');
      params.push(data.avatar);
    }
    
    if (updates.length > 0) {
      updates.push('updated_at = CURRENT_TIMESTAMP');
      params.push(clanId);
      
      await this.db.prepare(`
        UPDATE clans 
        SET ${updates.join(', ')}
        WHERE id = ?
      `).bind(...params).run();
    }
    
    // Update metadata in KV
    const metadataStr = await this.cache.get(`clan:meta:${clanId}`);
    const metadata = metadataStr ? JSON.parse(metadataStr) : {};
    
    const updatedMetadata = {
      ...metadata,
      ...(data.displayName !== undefined && { displayName: data.displayName }),
      ...(data.banner !== undefined && { banner: data.banner }),
      ...(data.isPrivate !== undefined && { isPrivate: data.isPrivate }),
      ...(data.categories !== undefined && { categories: data.categories }),
      ...(data.rules !== undefined && { rules: data.rules }),
      ...(data.theme !== undefined && { theme: data.theme })
    };
    
    await this.cache.put(
      `clan:meta:${clanId}`,
      JSON.stringify(updatedMetadata),
      { expirationTtl: 86400 }
    );
    
    // Clear cache
    await this.clearClanCache(clanId);
    
    return this.getClanDetails(clanId) as Promise<Clan>;
  }

  async deleteClan(clanId: string): Promise<void> {
    // Soft delete
    await this.db.prepare(`
      UPDATE clans 
      SET is_active = 0, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(clanId).run();
    
    // Clear all related caches
    await this.clearClanCache(clanId);
    await this.cache.delete(`clan:meta:${clanId}`);
  }

  async joinClan(clanId: string, userId: string): Promise<void> {
    // Check if already member
    const existing = await this.db.prepare(`
      SELECT 1 FROM clan_members 
      WHERE clan_id = ? AND user_id = ?
    `).bind(clanId, userId).first();
    
    if (existing) {
      throw new Error('User is already a member of this clan');
    }
    
    // Add member and update count in transaction
    const statements = [
      this.db.prepare(`
        INSERT INTO clan_members (clan_id, user_id, role, joined_at)
        VALUES (?, ?, 'member', CURRENT_TIMESTAMP)
      `).bind(clanId, userId),
      
      this.db.prepare(`
        UPDATE clans 
        SET member_count = member_count + 1, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).bind(clanId)
    ];
    
    await this.db.batch(statements);
    
    // Clear caches
    await this.clearClanCache(clanId);
    await this.invalidateClanCaches(userId);
  }

  async leaveClan(clanId: string, userId: string): Promise<void> {
    // Check if user is founder
    const membership = await this.db.prepare(`
      SELECT role FROM clan_members 
      WHERE clan_id = ? AND user_id = ?
    `).bind(clanId, userId).first();
    
    if (!membership) {
      throw new Error('User is not a member of this clan');
    }
    
    if (membership.role === 'founder') {
      throw new Error('Founder cannot leave the clan. Transfer ownership or delete the clan.');
    }
    
    // Remove member and update count
    const statements = [
      this.db.prepare(`
        DELETE FROM clan_members 
        WHERE clan_id = ? AND user_id = ?
      `).bind(clanId, userId),
      
      this.db.prepare(`
        UPDATE clans 
        SET member_count = member_count - 1, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).bind(clanId)
    ];
    
    await this.db.batch(statements);
    
    // Clear caches
    await this.clearClanCache(clanId);
    await this.invalidateClanCaches(userId);
  }

  async getClanMembers(
    clanId: string, 
    options: { page: number; limit: number; role?: string }
  ): Promise<{ members: ClanMember[]; total: number; hasMore: boolean }> {
    const offset = (options.page - 1) * options.limit;
    
    // Build query
    let whereClause = 'cm.clan_id = ?';
    const params: any[] = [clanId];
    
    if (options.role) {
      whereClause += ' AND cm.role = ?';
      params.push(options.role);
    }
    
    // Get total count
    const countResult = await this.db.prepare(`
      SELECT COUNT(*) as total 
      FROM clan_members cm
      WHERE ${whereClause}
    `).bind(...params).first();
    
    const total = countResult?.total as number || 0;
    
    // Get members with user info
    params.push(options.limit, offset);
    
    const members = await this.db.prepare(`
      SELECT 
        cm.user_id,
        cm.role,
        cm.joined_at,
        u.username,
        u.profile_image
      FROM clan_members cm
      JOIN users u ON cm.user_id = u.id
      WHERE ${whereClause}
      ORDER BY 
        CASE cm.role
          WHEN 'founder' THEN 1
          WHEN 'admin' THEN 2
          WHEN 'moderator' THEN 3
          ELSE 4
        END,
        cm.joined_at ASC
      LIMIT ? OFFSET ?
    `).bind(...params).all();
    
    return {
      members: members.results.map(m => ({
        user_id: m.user_id as string,
        username: m.username as string,
        profile_image: m.profile_image as string || undefined,
        role: m.role as 'founder' | 'admin' | 'moderator' | 'member',
        joined_at: m.joined_at as string
      })),
      total,
      hasMore: offset + options.limit < total
    };
  }

  async updateMemberRole(clanId: string, userId: string, newRole: string): Promise<void> {
    // Can't change founder role
    const currentRole = await this.db.prepare(`
      SELECT role FROM clan_members 
      WHERE clan_id = ? AND user_id = ?
    `).bind(clanId, userId).first();
    
    if (!currentRole) {
      throw new Error('User is not a member of this clan');
    }
    
    if (currentRole.role === 'founder') {
      throw new Error('Cannot change founder role');
    }
    
    await this.db.prepare(`
      UPDATE clan_members 
      SET role = ?
      WHERE clan_id = ? AND user_id = ?
    `).bind(newRole, clanId, userId).run();
    
    // Clear cache
    await this.clearClanCache(clanId);
  }

  async removeMember(clanId: string, userId: string): Promise<void> {
    // Can't remove founder
    const membership = await this.db.prepare(`
      SELECT role FROM clan_members 
      WHERE clan_id = ? AND user_id = ?
    `).bind(clanId, userId).first();
    
    if (!membership) {
      throw new Error('User is not a member of this clan');
    }
    
    if (membership.role === 'founder') {
      throw new Error('Cannot remove founder from clan');
    }
    
    // Remove member and update count
    const statements = [
      this.db.prepare(`
        DELETE FROM clan_members 
        WHERE clan_id = ? AND user_id = ?
      `).bind(clanId, userId),
      
      this.db.prepare(`
        UPDATE clans 
        SET member_count = member_count - 1, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).bind(clanId)
    ];
    
    await this.db.batch(statements);
    
    // Clear caches
    await this.clearClanCache(clanId);
    await this.invalidateClanCaches(userId);
  }

  async checkUserPermission(
    clanId: string, 
    userId: string, 
    requiredRole: 'founder' | 'admin' | 'moderator' | 'member'
  ): Promise<boolean> {
    const membership = await this.db.prepare(`
      SELECT role FROM clan_members 
      WHERE clan_id = ? AND user_id = ?
    `).bind(clanId, userId).first();
    
    if (!membership) {
      return false;
    }
    
    const roleHierarchy = {
      'founder': 4,
      'admin': 3,
      'moderator': 2,
      'member': 1
    };
    
    const userRoleLevel = roleHierarchy[membership.role as keyof typeof roleHierarchy] || 0;
    const requiredRoleLevel = roleHierarchy[requiredRole] || 0;
    
    return userRoleLevel >= requiredRoleLevel;
  }

  async listClans(options: ListClansOptions): Promise<{
    clans: Clan[];
    total: number;
    hasMore: boolean;
  }> {
    const offset = (options.page - 1) * options.limit;
    
    // Build query
    let whereClause = 'c.is_active = 1';
    const params: any[] = [];
    
    if (options.category) {
      // This would require a categories table or JSON search
      // For now, we'll search in cached metadata
    }
    
    if (options.search) {
      whereClause += ' AND (c.name LIKE ? OR c.description LIKE ?)';
      params.push(`%${options.search}%`, `%${options.search}%`);
    }
    
    // Determine sort order
    let orderBy = 'c.member_count DESC'; // popular
    if (options.sortBy === 'recent') {
      orderBy = 'c.created_at DESC';
    } else if (options.sortBy === 'active') {
      orderBy = 'c.updated_at DESC';
    }
    
    // Get total count
    const countResult = await this.db.prepare(`
      SELECT COUNT(*) as total 
      FROM clans c
      WHERE ${whereClause}
    `).bind(...params).first();
    
    const total = countResult?.total as number || 0;
    
    // Get clans
    params.push(options.limit, offset);
    
    const clans = await this.db.prepare(`
      SELECT 
        c.*,
        u.username as founder_username,
        u.profile_image as founder_profile_image
      FROM clans c
      JOIN users u ON c.founder_id = u.id
      WHERE ${whereClause}
      ORDER BY ${orderBy}
      LIMIT ? OFFSET ?
    `).bind(...params).all();
    
    // Enrich with metadata and membership status
    const enrichedClans = await Promise.all(
      clans.results.map(async (clan) => {
        const metadataStr = await this.cache.get(`clan:meta:${clan.id}`);
        const metadata = metadataStr ? JSON.parse(metadataStr) : {};
        
        let isMember = false;
        if (options.userId) {
          const membership = await this.db.prepare(`
            SELECT 1 FROM clan_members 
            WHERE clan_id = ? AND user_id = ?
          `).bind(clan.id, options.userId).first();
          isMember = !!membership;
        }
        
        return {
          id: clan.id as string,
          name: clan.name as string,
          displayName: metadata.displayName || clan.name as string,
          description: clan.description as string,
          avatar: clan.avatar_url as string || undefined,
          banner: metadata.banner,
          theme: metadata.theme,
          founder_id: clan.founder_id as string,
          founder: {
            id: clan.founder_id as string,
            username: clan.founder_username as string,
            profile_image: clan.founder_profile_image as string || undefined
          },
          member_count: clan.member_count as number,
          is_active: clan.is_active as boolean,
          is_private: metadata.isPrivate || false,
          categories: metadata.categories || [],
          created_at: clan.created_at as string,
          updated_at: clan.updated_at as string,
          isMember
        };
      })
    );
    
    return {
      clans: enrichedClans,
      total,
      hasMore: offset + options.limit < total
    };
  }

  async getUserClans(userId: string, page: number, limit: number): Promise<{
    clans: Clan[];
    total: number;
    hasMore: boolean;
  }> {
    const offset = (page - 1) * limit;
    
    // Get total count
    const countResult = await this.db.prepare(`
      SELECT COUNT(*) as total 
      FROM clan_members cm
      JOIN clans c ON cm.clan_id = c.id
      WHERE cm.user_id = ? AND c.is_active = 1
    `).bind(userId).first();
    
    const total = countResult?.total as number || 0;
    
    // Get user's clans
    const clans = await this.db.prepare(`
      SELECT 
        c.*,
        cm.role,
        cm.joined_at,
        u.username as founder_username,
        u.profile_image as founder_profile_image
      FROM clan_members cm
      JOIN clans c ON cm.clan_id = c.id
      JOIN users u ON c.founder_id = u.id
      WHERE cm.user_id = ? AND c.is_active = 1
      ORDER BY cm.joined_at DESC
      LIMIT ? OFFSET ?
    `).bind(userId, limit, offset).all();
    
    // Enrich with metadata
    const enrichedClans = await Promise.all(
      clans.results.map(async (clan) => {
        const metadataStr = await this.cache.get(`clan:meta:${clan.id}`);
        const metadata = metadataStr ? JSON.parse(metadataStr) : {};
        
        return {
          id: clan.id as string,
          name: clan.name as string,
          displayName: metadata.displayName || clan.name as string,
          description: clan.description as string,
          avatar: clan.avatar_url as string || undefined,
          banner: metadata.banner,
          theme: metadata.theme,
          founder_id: clan.founder_id as string,
          founder: {
            id: clan.founder_id as string,
            username: clan.founder_username as string,
            profile_image: clan.founder_profile_image as string || undefined
          },
          member_count: clan.member_count as number,
          is_active: clan.is_active as boolean,
          is_private: metadata.isPrivate || false,
          categories: metadata.categories || [],
          created_at: clan.created_at as string,
          updated_at: clan.updated_at as string,
          isMember: true,
          userRole: clan.role as string
        };
      })
    );
    
    return {
      clans: enrichedClans,
      total,
      hasMore: offset + limit < total
    };
  }

  async discoverClans(options: {
    page: number;
    limit: number;
    userId?: string;
  }): Promise<{
    clans: Clan[];
    total: number;
    hasMore: boolean;
  }> {
    const offset = (options.page - 1) * options.limit;
    
    // Get clans user is NOT a member of
    let whereClause = 'c.is_active = 1';
    const params: any[] = [];
    
    if (options.userId) {
      whereClause += ` AND c.id NOT IN (
        SELECT clan_id FROM clan_members WHERE user_id = ?
      )`;
      params.push(options.userId);
    }
    
    // Get total count
    const countResult = await this.db.prepare(`
      SELECT COUNT(*) as total 
      FROM clans c
      WHERE ${whereClause}
    `).bind(...params).first();
    
    const total = countResult?.total as number || 0;
    
    // Get clans sorted by popularity and recent activity
    params.push(options.limit, offset);
    
    const clans = await this.db.prepare(`
      SELECT 
        c.*,
        u.username as founder_username,
        u.profile_image as founder_profile_image
      FROM clans c
      JOIN users u ON c.founder_id = u.id
      WHERE ${whereClause}
      ORDER BY c.member_count DESC, c.updated_at DESC
      LIMIT ? OFFSET ?
    `).bind(...params).all();
    
    // Enrich with metadata
    const enrichedClans = await Promise.all(
      clans.results.map(async (clan) => {
        const metadataStr = await this.cache.get(`clan:meta:${clan.id}`);
        const metadata = metadataStr ? JSON.parse(metadataStr) : {};
        
        return {
          id: clan.id as string,
          name: clan.name as string,
          displayName: metadata.displayName || clan.name as string,
          description: clan.description as string,
          avatar: clan.avatar_url as string || undefined,
          banner: metadata.banner,
          theme: metadata.theme,
          founder_id: clan.founder_id as string,
          founder: {
            id: clan.founder_id as string,
            username: clan.founder_username as string,
            profile_image: clan.founder_profile_image as string || undefined
          },
          member_count: clan.member_count as number,
          is_active: clan.is_active as boolean,
          is_private: metadata.isPrivate || false,
          categories: metadata.categories || [],
          created_at: clan.created_at as string,
          updated_at: clan.updated_at as string,
          isMember: false
        };
      })
    );
    
    return {
      clans: enrichedClans,
      total,
      hasMore: offset + options.limit < total
    };
  }

  async getTrendingClans(timeframe: string, limit: number): Promise<{
    clans: Clan[];
  }> {
    // Calculate time window
    let timeWindow = '7 days';
    if (timeframe === 'day') {
      timeWindow = '1 day';
    } else if (timeframe === 'month') {
      timeWindow = '30 days';
    }
    
    // Get trending clans based on recent activity and growth
    const clans = await this.db.prepare(`
      SELECT 
        c.*,
        u.username as founder_username,
        u.profile_image as founder_profile_image,
        COUNT(DISTINCT p.id) as recent_posts,
        COUNT(DISTINCT cm.user_id) as recent_members
      FROM clans c
      JOIN users u ON c.founder_id = u.id
      LEFT JOIN posts p ON p.clan_id = c.id 
        AND p.created_at > datetime('now', '-${timeWindow}')
      LEFT JOIN clan_members cm ON cm.clan_id = c.id 
        AND cm.joined_at > datetime('now', '-${timeWindow}')
      WHERE c.is_active = 1
      GROUP BY c.id
      ORDER BY (recent_posts * 2 + recent_members * 3 + c.member_count) DESC
      LIMIT ?
    `).bind(limit).all();
    
    // Enrich with metadata
    const enrichedClans = await Promise.all(
      clans.results.map(async (clan) => {
        const metadataStr = await this.cache.get(`clan:meta:${clan.id}`);
        const metadata = metadataStr ? JSON.parse(metadataStr) : {};
        
        return {
          id: clan.id as string,
          name: clan.name as string,
          displayName: metadata.displayName || clan.name as string,
          description: clan.description as string,
          avatar: clan.avatar_url as string || undefined,
          banner: metadata.banner,
          theme: metadata.theme,
          founder_id: clan.founder_id as string,
          founder: {
            id: clan.founder_id as string,
            username: clan.founder_username as string,
            profile_image: clan.founder_profile_image as string || undefined
          },
          member_count: clan.member_count as number,
          is_active: clan.is_active as boolean,
          is_private: metadata.isPrivate || false,
          categories: metadata.categories || [],
          created_at: clan.created_at as string,
          updated_at: clan.updated_at as string,
          stats: {
            totalPosts: clan.recent_posts as number || 0,
            postsToday: clan.recent_posts as number || 0,
            activeMembers: clan.recent_members as number || 0,
            growthRate: 0,
            engagementRate: 0,
            recentPosts: clan.recent_posts as number,
            recentMembers: clan.recent_members as number
          } as ClanStats
        };
      })
    );
    
    return { clans: enrichedClans };
  }

  async searchClans(query: string, page: number, limit: number): Promise<{
    clans: Clan[];
    total: number;
    hasMore: boolean;
  }> {
    const offset = (page - 1) * limit;
    
    // Search in name and description
    const searchPattern = `%${query}%`;
    
    // Get total count
    const countResult = await this.db.prepare(`
      SELECT COUNT(*) as total 
      FROM clans c
      WHERE c.is_active = 1 
        AND (c.name LIKE ? OR c.description LIKE ?)
    `).bind(searchPattern, searchPattern).first();
    
    const total = countResult?.total as number || 0;
    
    // Get matching clans
    const clans = await this.db.prepare(`
      SELECT 
        c.*,
        u.username as founder_username,
        u.profile_image as founder_profile_image
      FROM clans c
      JOIN users u ON c.founder_id = u.id
      WHERE c.is_active = 1 
        AND (c.name LIKE ? OR c.description LIKE ?)
      ORDER BY 
        CASE 
          WHEN c.name LIKE ? THEN 1
          ELSE 2
        END,
        c.member_count DESC
      LIMIT ? OFFSET ?
    `).bind(searchPattern, searchPattern, `${query}%`, limit, offset).all();
    
    // Enrich with metadata
    const enrichedClans = await Promise.all(
      clans.results.map(async (clan) => {
        const metadataStr = await this.cache.get(`clan:meta:${clan.id}`);
        const metadata = metadataStr ? JSON.parse(metadataStr) : {};
        
        return {
          id: clan.id as string,
          name: clan.name as string,
          displayName: metadata.displayName || clan.name as string,
          description: clan.description as string,
          avatar: clan.avatar_url as string || undefined,
          banner: metadata.banner,
          theme: metadata.theme,
          founder_id: clan.founder_id as string,
          founder: {
            id: clan.founder_id as string,
            username: clan.founder_username as string,
            profile_image: clan.founder_profile_image as string || undefined
          },
          member_count: clan.member_count as number,
          is_active: clan.is_active as boolean,
          is_private: metadata.isPrivate || false,
          categories: metadata.categories || [],
          created_at: clan.created_at as string,
          updated_at: clan.updated_at as string
        };
      })
    );
    
    return {
      clans: enrichedClans,
      total,
      hasMore: offset + limit < total
    };
  }

  async getClanStats(clanId: string, timeframe: string): Promise<ClanStats> {
    // Calculate time window
    let timeWindow = '7 days';
    if (timeframe === 'day') {
      timeWindow = '1 day';
    } else if (timeframe === 'month') {
      timeWindow = '30 days';
    }
    
    // Get post statistics
    const postStats = await this.db.prepare(`
      SELECT 
        COUNT(*) as total_posts,
        COUNT(CASE WHEN created_at > datetime('now', '-1 day') THEN 1 END) as posts_today
      FROM posts
      WHERE clan_id = ?
    `).bind(clanId).first();
    
    // Get active members count
    const activeMembers = await this.db.prepare(`
      SELECT COUNT(DISTINCT p.user_id) as active_members
      FROM posts p
      WHERE p.clan_id = ? 
        AND p.created_at > datetime('now', '-${timeWindow}')
    `).bind(clanId).first();
    
    // Get growth rate (new members in timeframe)
    const newMembers = await this.db.prepare(`
      SELECT COUNT(*) as new_members
      FROM clan_members
      WHERE clan_id = ? 
        AND joined_at > datetime('now', '-${timeWindow}')
    `).bind(clanId).first();
    
    // Get total members for growth rate calculation
    const totalMembers = await this.db.prepare(`
      SELECT member_count FROM clans WHERE id = ?
    `).bind(clanId).first();
    
    const memberCount = totalMembers?.member_count as number || 1;
    const growthRate = ((newMembers?.new_members as number || 0) / memberCount) * 100;
    
    // Calculate engagement rate (active members / total members)
    const engagementRate = ((activeMembers?.active_members as number || 0) / memberCount) * 100;
    
    return {
      totalPosts: postStats?.total_posts as number || 0,
      postsToday: postStats?.posts_today as number || 0,
      activeMembers: activeMembers?.active_members as number || 0,
      growthRate: Math.round(growthRate * 100) / 100,
      engagementRate: Math.round(engagementRate * 100) / 100
    };
  }

  private async clearClanCache(clanId: string): Promise<void> {
    // Clear all cached versions of this clan
    const cachePattern = `clan:${clanId}:`;
    // Note: KV doesn't support pattern deletion, so we track keys separately
    // In production, you might want to use a different caching strategy
    
    // For now, clear known patterns
    await this.cache.delete(`clan:${clanId}:public`);
    // Clear user-specific caches would require tracking user IDs
  }

  private async invalidateClanCaches(userId: string): Promise<void> {
    // Clear user's clan list cache
    await this.cache.delete(`user:clans:${userId}`);
    // Clear discovery cache if it exists
    await this.cache.delete(`clans:discover:${userId}`);
  }
}