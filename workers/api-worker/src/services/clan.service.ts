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
  founder: string; // Changed from founder_id to match frontend
  founder_details?: { // Optional founder details
    id: string;
    username: string;
    profileImage?: string;
  };
  admins?: string[];
  moderators?: string[];
  memberCount: number; // Changed from member_count
  settings?: any;
  rules?: Array<{ title: string; description: string }>;
  categories?: string[];
  tags?: string[];
  stats?: ClanStats;
  bannedUsers?: string[];
  status: 'active' | 'suspended' | 'deleted';
  verificationStatus?: 'unverified' | 'verified' | 'official';
  isPrivate?: boolean;
  createdAt: string; // Changed from created_at
  updatedAt: string; // Changed from updated_at
  
  // Computed fields
  isMember?: boolean;
  userRole?: string;
}

export interface ClanMember {
  uid: string; // Changed from user_id to match frontend
  username?: string;
  profileImage?: string; // Changed from profile_image
  joinedAt: string; // Changed from joined_at
  role: 'founder' | 'admin' | 'moderator' | 'member';
  reputation?: number;
  contributions?: number;
}

export interface ClanStats {
  totalPosts: number;
  dailyActiveUsers: number;
  weeklyActiveUsers: number;
  monthlyActiveUsers: number;
  growthRate: number;
  engagementRate: number;
  postsToday: number;
  activeUsers: number;
  activeMembers: number;
  recentPosts: number;
  recentMembers: number;
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
    
    // Insert clan with all new fields
    statements.push(
      this.db.prepare(`
        INSERT INTO clans (
          id, name, display_name, description, avatar_url, banner_url,
          theme, founder_id, member_count, is_active, is_private,
          verification_status, categories, rules, settings,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `).bind(
        clanId,
        data.name.toLowerCase(),
        data.displayName || data.name,
        data.description,
        data.avatar || null,
        data.banner || null,
        JSON.stringify(data.theme || null),
        founderId,
        data.isPrivate || false,
        'unverified',
        JSON.stringify(data.categories || []),
        JSON.stringify(data.rules || []),
        JSON.stringify(data.settings || {})
      )
    );
    
    // Add founder as first member
    statements.push(
      this.db.prepare(`
        INSERT INTO clan_members (clan_id, user_id, role, reputation, contributions, joined_at)
        VALUES (?, ?, 'founder', 0, 0, CURRENT_TIMESTAMP)
      `).bind(clanId, founderId)
    );
    
    // Execute transaction
    await this.db.batch(statements);
    
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
    
    // Get clan from database with all new fields
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
    
    // Get admins and moderators
    const roleMembers = await this.db.prepare(`
      SELECT user_id, role FROM clan_members 
      WHERE clan_id = ? AND role IN ('admin', 'moderator')
    `).bind(clanId).all();
    
    const admins = roleMembers.results
      .filter(m => m.role === 'admin')
      .map(m => m.user_id as string);
    
    const moderators = roleMembers.results
      .filter(m => m.role === 'moderator')
      .map(m => m.user_id as string);
    
    // Get banned users
    const bannedResult = await this.db.prepare(`
      SELECT user_id FROM clan_banned_users WHERE clan_id = ?
    `).bind(clanId).all();
    
    const bannedUsers = bannedResult.results.map(b => b.user_id as string);
    
    // Get stats
    const stats = await this.getClanStats(clanId, 'day');
    
    // Parse JSON fields
    const theme = clan.theme ? JSON.parse(clan.theme as string) : undefined;
    const categories = clan.categories ? JSON.parse(clan.categories as string) : [];
    const rules = clan.rules ? JSON.parse(clan.rules as string) : [];
    const settings = clan.settings ? JSON.parse(clan.settings as string) : undefined;
    
    const clanData: Clan = {
      id: clan.id as string,
      name: clan.name as string,
      displayName: clan.display_name as string || clan.name as string,
      description: clan.description as string,
      avatar: clan.avatar_url as string || undefined,
      banner: clan.banner_url as string || undefined,
      theme,
      founder: clan.founder_id as string, // Return as 'founder' not 'founder_id'
      founder_details: {
        id: clan.founder_id as string,
        username: clan.founder_username as string,
        profileImage: clan.founder_profile_image as string || undefined
      },
      admins,
      moderators,
      memberCount: clan.member_count as number,
      settings,
      rules,
      categories,
      tags: [], // Add if you have tags
      stats,
      bannedUsers,
      status: clan.is_active ? 'active' : 'suspended',
      verificationStatus: clan.verification_status as 'unverified' | 'verified' | 'official',
      isPrivate: clan.is_private as boolean,
      createdAt: clan.created_at as string,
      updatedAt: clan.updated_at as string,
      isMember,
      userRole: userRole || undefined
    };
    
    // Cache the result
    await this.cache.put(cacheKey, JSON.stringify(clanData), {
      expirationTtl: 300 // 5 minutes
    });
    
    return clanData;
  }

  async updateClan(clanId: string, data: any): Promise<Clan> {
    // Build update query
    const updates = [];
    const params = [];
    
    if (data.displayName !== undefined) {
      updates.push('display_name = ?');
      params.push(data.displayName);
    }
    
    if (data.description !== undefined) {
      updates.push('description = ?');
      params.push(data.description);
    }
    
    if (data.avatar !== undefined) {
      updates.push('avatar_url = ?');
      params.push(data.avatar);
    }
    
    if (data.banner !== undefined) {
      updates.push('banner_url = ?');
      params.push(data.banner);
    }
    
    if (data.theme !== undefined) {
      updates.push('theme = ?');
      params.push(JSON.stringify(data.theme));
    }
    
    if (data.isPrivate !== undefined) {
      updates.push('is_private = ?');
      params.push(data.isPrivate);
    }
    
    if (data.categories !== undefined) {
      updates.push('categories = ?');
      params.push(JSON.stringify(data.categories));
    }
    
    if (data.rules !== undefined) {
      updates.push('rules = ?');
      params.push(JSON.stringify(data.rules));
    }
    
    if (data.settings !== undefined) {
      updates.push('settings = ?');
      params.push(JSON.stringify(data.settings));
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
    
    // Check if user is banned
    const banned = await this.db.prepare(`
      SELECT 1 FROM clan_banned_users 
      WHERE clan_id = ? AND user_id = ?
    `).bind(clanId, userId).first();
    
    if (banned) {
      throw new Error('You are banned from this clan');
    }
    
    // Add member and update count in transaction
    const statements = [
      this.db.prepare(`
        INSERT INTO clan_members (clan_id, user_id, role, reputation, contributions, joined_at)
        VALUES (?, ?, 'member', 0, 0, CURRENT_TIMESTAMP)
      `).bind(clanId, userId),
      
      this.db.prepare(`
        UPDATE clans 
        SET member_count = member_count + 1, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).bind(clanId)
    ];
    
    await this.db.batch(statements);
    
    // Log activity
    await this.logActivity(clanId, userId, 'join', null);
    
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
    
    // Log activity
    await this.logActivity(clanId, userId, 'leave', null);
    
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
        cm.reputation,
        cm.contributions,
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
    
    const formattedMembers: ClanMember[] = members.results.map(m => ({
      uid: m.user_id as string, // Changed to uid
      username: m.username as string,
      profileImage: m.profile_image as string || undefined, // Changed to profileImage
      joinedAt: m.joined_at as string, // Changed to joinedAt
      role: m.role as 'founder' | 'admin' | 'moderator' | 'member',
      reputation: m.reputation as number,
      contributions: m.contributions as number
    }));
    
    return {
      members: formattedMembers,
      total,
      hasMore: offset + options.limit < total
    };
  }

  async updateMemberRole(clanId: string, userId: string, newRole: string): Promise<void> {
    // Can't change founder role
    const currentMembership = await this.db.prepare(`
      SELECT role FROM clan_members 
      WHERE clan_id = ? AND user_id = ?
    `).bind(clanId, userId).first();
    
    if (!currentMembership) {
      throw new Error('User is not a member of this clan');
    }
    
    if (currentMembership.role === 'founder') {
      throw new Error('Cannot change founder role');
    }
    
    await this.db.prepare(`
      UPDATE clan_members 
      SET role = ?
      WHERE clan_id = ? AND user_id = ?
    `).bind(newRole, clanId, userId).run();
    
    // Log activity
    await this.logActivity(clanId, userId, 'role_change', null, { newRole });
    
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
      throw new Error('Cannot remove the founder');
    }
    
    const statements = [
      this.db.prepare(`
        DELETE FROM clan_members 
        WHERE clan_id = ? AND user_id = ?
      `).bind(clanId, userId),
      
      this.db.prepare(`
        UPDATE clans 
        SET member_count = member_count - 1
        WHERE id = ?
      `).bind(clanId)
    ];
    
    await this.db.batch(statements);
    
    await this.clearClanCache(clanId);
    await this.invalidateClanCaches(userId);
  }

  async banUser(clanId: string, userId: string, bannedBy: string, reason?: string): Promise<void> {
    // First remove them if they're a member
    const membership = await this.db.prepare(`
      SELECT role FROM clan_members 
      WHERE clan_id = ? AND user_id = ?
    `).bind(clanId, userId).first();
    
    if (membership) {
      if (membership.role === 'founder') {
        throw new Error('Cannot ban the founder');
      }
      
      // Remove from members
      await this.removeMember(clanId, userId);
    }
    
    // Add to banned list
    const banId = nanoid();
    await this.db.prepare(`
      INSERT INTO clan_banned_users (id, clan_id, user_id, banned_by, reason, banned_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).bind(banId, clanId, userId, bannedBy, reason || null).run();
    
    // Log activity
    await this.logActivity(clanId, bannedBy, 'ban', userId, { reason });
    
    await this.clearClanCache(clanId);
  }

  async unbanUser(clanId: string, userId: string, unbannedBy: string): Promise<void> {
    await this.db.prepare(`
      DELETE FROM clan_banned_users 
      WHERE clan_id = ? AND user_id = ?
    `).bind(clanId, userId).run();
    
    // Log activity
    await this.logActivity(clanId, unbannedBy, 'unban', userId);
    
    await this.clearClanCache(clanId);
  }

  async getClanStats(clanId: string, timeframe: string): Promise<ClanStats> {
    // Get today's stats from clan_stats table
    const today = new Date().toISOString().split('T')[0];
    
    const stats = await this.db.prepare(`
      SELECT * FROM clan_stats 
      WHERE clan_id = ? AND date = ?
    `).bind(clanId, today).first();
    
    if (stats) {
      return {
        totalPosts: stats.total_posts as number,
        dailyActiveUsers: stats.daily_active_users as number,
        weeklyActiveUsers: stats.weekly_active_users as number,
        monthlyActiveUsers: stats.monthly_active_users as number,
        growthRate: stats.growth_rate as number,
        engagementRate: stats.engagement_rate as number,
        postsToday: stats.posts_today as number,
        activeUsers: stats.daily_active_users as number,
        activeMembers: stats.daily_active_users as number,
        recentPosts: stats.posts_today as number,
        recentMembers: stats.new_members as number
      };
    }
    
    // Return default stats if no data
    return {
      totalPosts: 0,
      dailyActiveUsers: 0,
      weeklyActiveUsers: 0,
      monthlyActiveUsers: 0,
      growthRate: 0,
      engagementRate: 0,
      postsToday: 0,
      activeUsers: 0,
      activeMembers: 0,
      recentPosts: 0,
      recentMembers: 0
    };
  }

  async getClanActivity(clanId: string, timeframe: string): Promise<any[]> {
    const timeframeDays = {
      'day': 1,
      'week': 7,
      'month': 30
    };
    
    const days = timeframeDays[timeframe as keyof typeof timeframeDays] || 7;
    
    const activities = await this.db.prepare(`
      SELECT 
        ca.*,
        u.username,
        u.profile_image
      FROM clan_activity ca
      JOIN users u ON ca.user_id = u.id
      WHERE ca.clan_id = ? 
        AND ca.created_at >= datetime('now', '-${days} days')
      ORDER BY ca.created_at DESC
      LIMIT 100
    `).bind(clanId).all();
    
    return activities.results.map(a => ({
      id: a.id,
      userId: a.user_id,
      username: a.username,
      profileImage: a.profile_image,
      activityType: a.activity_type,
      targetId: a.target_id,
      details: a.details ? JSON.parse(a.details as string) : null,
      createdAt: a.created_at
    }));
  }

  private async logActivity(
    clanId: string, 
    userId: string, 
    activityType: string, 
    targetId: string | null,
    details?: any
  ): Promise<void> {
    const activityId = nanoid();
    await this.db.prepare(`
      INSERT INTO clan_activity (id, clan_id, user_id, activity_type, target_id, details, created_at)
      VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).bind(
      activityId,
      clanId,
      userId,
      activityType,
      targetId,
      details ? JSON.stringify(details) : null
    ).run();
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

  // List methods remain similar but return formatted data
  async listClans(options: ListClansOptions): Promise<{
    clans: Clan[];
    total: number;
    hasMore: boolean;
  }> {
    const offset = (options.page - 1) * options.limit;
    
    // Build query
    let whereClause = 'c.is_active = 1';
    const params: any[] = [];
    
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
    
    // Format clans
    const formattedClans = await Promise.all(
      clans.results.map(async (clan) => {
        let isMember = false;
        let userRole = undefined;
        
        if (options.userId) {
          const membership = await this.db.prepare(`
            SELECT role FROM clan_members 
            WHERE clan_id = ? AND user_id = ?
          `).bind(clan.id, options.userId).first();
          
          if (membership) {
            isMember = true;
            userRole = membership.role as string;
          }
        }
        
        return this.formatClanData(clan, isMember, userRole);
      })
    );
    
    return {
      clans: formattedClans,
      total,
      hasMore: offset + options.limit < total
    };
  }

  // Similar updates for other list methods...
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
    
    // Format clans
    const formattedClans = clans.results.map(clan => 
      this.formatClanData(clan, true, clan.role as string)
    );
    
    return {
      clans: formattedClans,
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
      ORDER BY c.member_count DESC, c.updated_at DESC
      LIMIT ? OFFSET ?
    `).bind(...params).all();
    
    // Format clans
    const formattedClans = clans.results.map(clan => 
      this.formatClanData(clan, false, undefined)
    );
    
    return {
      clans: formattedClans,
      total,
      hasMore: offset + options.limit < total
    };
  }

  async getTrendingClans(timeframe: string, limit: number): Promise<{ clans: Clan[] }> {
    const clans = await this.db.prepare(`
      SELECT 
        c.*,
        u.username as founder_username,
        u.profile_image as founder_profile_image,
        COUNT(DISTINCT ca.id) as recent_activity
      FROM clans c
      JOIN users u ON c.founder_id = u.id
      LEFT JOIN clan_activity ca ON c.id = ca.clan_id 
        AND ca.created_at >= datetime('now', '-7 days')
      WHERE c.is_active = 1
      GROUP BY c.id
      ORDER BY recent_activity DESC, c.member_count DESC
      LIMIT ?
    `).bind(limit).all();
    
    // Format clans
    const formattedClans = clans.results.map(clan => 
      this.formatClanData(clan, false, undefined)
    );
    
    return { clans: formattedClans };
  }

  async searchClans(query: string, page: number, limit: number): Promise<{
    clans: Clan[];
    total: number;
    hasMore: boolean;
  }> {
    const offset = (page - 1) * limit;
    const searchPattern = `%${query}%`;
    
    // Get total count
    const countResult = await this.db.prepare(`
      SELECT COUNT(*) as total 
      FROM clans c
      WHERE c.is_active = 1 
        AND (c.name LIKE ? OR c.description LIKE ? OR c.display_name LIKE ?)
    `).bind(searchPattern, searchPattern, searchPattern).first();
    
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
        AND (c.name LIKE ? OR c.description LIKE ? OR c.display_name LIKE ?)
      ORDER BY 
        CASE 
          WHEN c.name LIKE ? THEN 1
          WHEN c.display_name LIKE ? THEN 2
          ELSE 3
        END,
        c.member_count DESC
      LIMIT ? OFFSET ?
    `).bind(
      searchPattern, searchPattern, searchPattern,
      query, query,
      limit, offset
    ).all();
    
    // Format clans
    const formattedClans = clans.results.map(clan => 
      this.formatClanData(clan, false, undefined)
    );
    
    return {
      clans: formattedClans,
      total,
      hasMore: offset + limit < total
    };
  }

  // Helper method to format clan data
  private formatClanData(clan: any, isMember: boolean, userRole?: string): Clan {
    const theme = clan.theme ? JSON.parse(clan.theme) : undefined;
    const categories = clan.categories ? JSON.parse(clan.categories) : [];
    const rules = clan.rules ? JSON.parse(clan.rules) : [];
    const settings = clan.settings ? JSON.parse(clan.settings) : undefined;
    
    return {
      id: clan.id,
      name: clan.name,
      displayName: clan.display_name || clan.name,
      description: clan.description,
      avatar: clan.avatar_url || undefined,
      banner: clan.banner_url || undefined,
      theme,
      founder: clan.founder_id, // Return as 'founder'
      founder_details: {
        id: clan.founder_id,
        username: clan.founder_username,
        profileImage: clan.founder_profile_image || undefined
      },
      memberCount: clan.member_count,
      settings,
      rules,
      categories,
      tags: [],
      status: clan.is_active ? 'active' : 'suspended',
      verificationStatus: clan.verification_status,
      isPrivate: clan.is_private,
      createdAt: clan.created_at,
      updatedAt: clan.updated_at,
      isMember,
      userRole
    };
  }

  // Cache management methods
  private async clearClanCache(clanId: string): Promise<void> {
    const keys = await this.cache.list({ prefix: `clan:${clanId}:` });
    for (const key of keys.keys) {
      await this.cache.delete(key.name);
    }
  }

  private async invalidateClanCaches(userId: string): Promise<void> {
    // Invalidate user-specific caches
    const keys = await this.cache.list({ prefix: `user:${userId}:clans` });
    for (const key of keys.keys) {
      await this.cache.delete(key.name);
    }
  }
}