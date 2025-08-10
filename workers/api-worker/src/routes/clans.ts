// workers/api-worker/src/routes/clans.ts

import { Hono } from 'hono';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import type { Env } from '../types';
import { ClanService } from '../services/clan.service';
import { validateRequest } from '../utils/validation';
import { authMiddleware } from '../middleware/auth';

type Variables = {
  user?: {
    id: string;
    email: string;
    username: string;
  };
};

const router = new Hono<{ Bindings: Env; Variables: Variables }>();

// Apply auth middleware to all routes except public discovery
router.use('/*', async (c, next) => {
  const path = c.req.path;
  // Allow public access to discover and individual clan details
  if (path.includes('/discover') || (path.match(/\/clans\/[^\/]+$/) && c.req.method === 'GET')) {
    return next();
  }
  return authMiddleware(c, next);
});

// Validation schemas
const createClanSchema = z.object({
  name: z.string().min(3).max(30).regex(/^[a-z0-9-]+$/, 'Name must be lowercase alphanumeric with hyphens only'),
  displayName: z.string().min(3).max(50),
  description: z.string().min(10).max(500),
  avatar: z.string().url().optional(),
  banner: z.string().url().optional(),
  isPrivate: z.boolean().default(false),
  categories: z.array(z.string()).max(5).optional(),
  rules: z.array(z.object({
    title: z.string().max(100),
    description: z.string().max(500)
  })).max(10).optional()
});

const updateClanSchema = z.object({
  displayName: z.string().min(3).max(50).optional(),
  description: z.string().min(10).max(500).optional(),
  avatar: z.string().url().optional(),
  banner: z.string().url().optional(),
  isPrivate: z.boolean().optional(),
  categories: z.array(z.string()).max(5).optional(),
  rules: z.array(z.object({
    title: z.string().max(100),
    description: z.string().max(500)
  })).max(10).optional()
});

const updateMemberRoleSchema = z.object({
  role: z.enum(['admin', 'moderator', 'member'])
});

// Get all clans (with pagination and filters)
router.get('/', async (c) => {
  try {
    const page = parseInt(c.req.query('page') || '1');
    const limit = Math.min(parseInt(c.req.query('limit') || '20'), 100);
    const category = c.req.query('category');
    const search = c.req.query('search');
    const sortBy = c.req.query('sortBy') || 'popular'; // popular, recent, active
    
    const clanService = new ClanService(c.env.DB, c.env.CACHE);
    const result = await clanService.listClans({
      page,
      limit,
      category,
      search,
      sortBy,
      userId: c.get('user')?.id
    });
    
    return c.json({
      success: true,
      clans: result.clans,
      pagination: {
        page,
        limit,
        total: result.total,
        hasMore: result.hasMore
      }
    });
  } catch (error) {
    console.error('List clans error:', error);
    return c.json({ success: false, error: 'Failed to fetch clans' }, 500);
  }
});

// Discover clans (personalized recommendations)
router.get('/discover', async (c) => {
  try {
    const page = parseInt(c.req.query('page') || '1');
    const limit = Math.min(parseInt(c.req.query('limit') || '20'), 100);
    
    const clanService = new ClanService(c.env.DB, c.env.CACHE);
    const result = await clanService.discoverClans({
      page,
      limit,
      userId: c.get('user')?.id
    });
    
    return c.json({
      success: true,
      clans: result.clans,
      pagination: {
        page,
        limit,
        total: result.total,
        hasMore: result.hasMore
      }
    });
  } catch (error) {
    console.error('Discover clans error:', error);
    return c.json({ success: false, error: 'Failed to discover clans' }, 500);
  }
});

// Get user's clans
router.get('/my-clans', async (c) => {
  try {
    const user = c.get('user');
    if (!user) {
      return c.json({ success: false, error: 'Unauthorized' }, 401);
    }
    
    const page = parseInt(c.req.query('page') || '1');
    const limit = Math.min(parseInt(c.req.query('limit') || '20'), 100);
    
    const clanService = new ClanService(c.env.DB, c.env.CACHE);
    const result = await clanService.getUserClans(user.id, page, limit);
    
    return c.json({
      success: true,
      clans: result.clans,
      pagination: {
        page,
        limit,
        total: result.total,
        hasMore: result.hasMore
      }
    });
  } catch (error) {
    console.error('Get user clans error:', error);
    return c.json({ success: false, error: 'Failed to fetch user clans' }, 500);
  }
});

// Get trending clans
router.get('/trending', async (c) => {
  try {
    const timeframe = c.req.query('timeframe') || 'week'; // day, week, month
    const limit = Math.min(parseInt(c.req.query('limit') || '10'), 50);
    
    const clanService = new ClanService(c.env.DB, c.env.CACHE);
    const result = await clanService.getTrendingClans(timeframe, limit);
    
    return c.json({
      success: true,
      clans: result.clans
    });
  } catch (error) {
    console.error('Get trending clans error:', error);
    return c.json({ success: false, error: 'Failed to fetch trending clans' }, 500);
  }
});

// Create a new clan
router.post('/', async (c) => {
  try {
    const user = c.get('user');
    if (!user) {
      return c.json({ success: false, error: 'Unauthorized' }, 401);
    }
    
    const body = await c.req.json();
    const validated = validateRequest(createClanSchema, body);
    
    if (!validated.success) {
      return c.json({ 
        success: false, 
        error: 'Invalid input', 
        details: validated.errors 
      }, 400);
    }
    
    const clanService = new ClanService(c.env.DB, c.env.CACHE);
    const clan = await clanService.createClan(user.id, validated.data);
    
    return c.json({
      success: true,
      data: clan
    });
  } catch (error: any) {
    console.error('Create clan error:', error);
    
    // Handle unique constraint violation
    if (error.message?.includes('UNIQUE constraint failed')) {
      return c.json({ 
        success: false, 
        error: 'A clan with this name already exists' 
      }, 409);
    }
    
    return c.json({ success: false, error: 'Failed to create clan' }, 500);
  }
});

// Get clan details
router.get('/:id', async (c) => {
  try {
    const clanId = c.req.param('id');
    const userId = c.get('user')?.id;
    
    const clanService = new ClanService(c.env.DB, c.env.CACHE);
    const clan = await clanService.getClanDetails(clanId, userId);
    
    if (!clan) {
      return c.json({ success: false, error: 'Clan not found' }, 404);
    }
    
    return c.json({
      success: true,
      data: clan
    });
  } catch (error) {
    console.error('Get clan details error:', error);
    return c.json({ success: false, error: 'Failed to fetch clan details' }, 500);
  }
});

// Update clan
router.put('/:id', async (c) => {
  try {
    const user = c.get('user');
    if (!user) {
      return c.json({ success: false, error: 'Unauthorized' }, 401);
    }
    
    const clanId = c.req.param('id');
    const body = await c.req.json();
    const validated = validateRequest(updateClanSchema, body);
    
    if (!validated.success) {
      return c.json({ 
        success: false, 
        error: 'Invalid input', 
        details: validated.errors 
      }, 400);
    }
    
    const clanService = new ClanService(c.env.DB, c.env.CACHE);
    
    // Check if user has permission to update clan
    const hasPermission = await clanService.checkUserPermission(clanId, user.id, 'admin');
    if (!hasPermission) {
      return c.json({ success: false, error: 'Insufficient permissions' }, 403);
    }
    
    const updatedClan = await clanService.updateClan(clanId, validated.data);
    
    return c.json({
      success: true,
      data: updatedClan
    });
  } catch (error) {
    console.error('Update clan error:', error);
    return c.json({ success: false, error: 'Failed to update clan' }, 500);
  }
});

// Delete clan
router.delete('/:id', async (c) => {
  try {
    const user = c.get('user');
    if (!user) {
      return c.json({ success: false, error: 'Unauthorized' }, 401);
    }
    
    const clanId = c.req.param('id');
    const clanService = new ClanService(c.env.DB, c.env.CACHE);
    
    // Only founder can delete clan
    const hasPermission = await clanService.checkUserPermission(clanId, user.id, 'founder');
    if (!hasPermission) {
      return c.json({ success: false, error: 'Only the founder can delete the clan' }, 403);
    }
    
    await clanService.deleteClan(clanId);
    
    return c.json({
      success: true,
      message: 'Clan deleted successfully'
    });
  } catch (error) {
    console.error('Delete clan error:', error);
    return c.json({ success: false, error: 'Failed to delete clan' }, 500);
  }
});

// Join clan
router.post('/:id/join', async (c) => {
  try {
    const user = c.get('user');
    if (!user) {
      return c.json({ success: false, error: 'Unauthorized' }, 401);
    }
    
    const clanId = c.req.param('id');
    const clanService = new ClanService(c.env.DB, c.env.CACHE);
    
    await clanService.joinClan(clanId, user.id);
    
    return c.json({
      success: true,
      message: 'Successfully joined clan'
    });
  } catch (error: any) {
    console.error('Join clan error:', error);
    
    if (error.message?.includes('already a member')) {
      return c.json({ success: false, error: error.message }, 409);
    }
    
    return c.json({ success: false, error: 'Failed to join clan' }, 500);
  }
});

// Leave clan
router.post('/:id/leave', async (c) => {
  try {
    const user = c.get('user');
    if (!user) {
      return c.json({ success: false, error: 'Unauthorized' }, 401);
    }
    
    const clanId = c.req.param('id');
    const clanService = new ClanService(c.env.DB, c.env.CACHE);
    
    await clanService.leaveClan(clanId, user.id);
    
    return c.json({
      success: true,
      message: 'Successfully left clan'
    });
  } catch (error: any) {
    console.error('Leave clan error:', error);
    
    if (error.message?.includes('cannot leave')) {
      return c.json({ success: false, error: error.message }, 403);
    }
    
    return c.json({ success: false, error: 'Failed to leave clan' }, 500);
  }
});

// Get clan members
router.get('/:id/members', async (c) => {
  try {
    const clanId = c.req.param('id');
    const page = parseInt(c.req.query('page') || '1');
    const limit = Math.min(parseInt(c.req.query('limit') || '50'), 100);
    const role = c.req.query('role');
    
    const clanService = new ClanService(c.env.DB, c.env.CACHE);
    const result = await clanService.getClanMembers(clanId, { page, limit, role });
    
    return c.json({
      success: true,
      members: result.members,
      pagination: {
        page,
        limit,
        total: result.total,
        hasMore: result.hasMore
      }
    });
  } catch (error) {
    console.error('Get clan members error:', error);
    return c.json({ success: false, error: 'Failed to fetch clan members' }, 500);
  }
});

// Update member role
router.put('/:id/members/:userId', async (c) => {
  try {
    const user = c.get('user');
    if (!user) {
      return c.json({ success: false, error: 'Unauthorized' }, 401);
    }
    
    const clanId = c.req.param('id');
    const targetUserId = c.req.param('userId');
    const body = await c.req.json();
    
    const validated = validateRequest(updateMemberRoleSchema, body);
    if (!validated.success) {
      return c.json({ 
        success: false, 
        error: 'Invalid input', 
        details: validated.errors 
      }, 400);
    }
    
    const clanService = new ClanService(c.env.DB, c.env.CACHE);
    
    // Check if user has permission to update roles
    const hasPermission = await clanService.checkUserPermission(clanId, user.id, 'admin');
    if (!hasPermission) {
      return c.json({ success: false, error: 'Insufficient permissions' }, 403);
    }
    
    await clanService.updateMemberRole(clanId, targetUserId, validated.data.role);
    
    return c.json({
      success: true,
      message: 'Member role updated successfully'
    });
  } catch (error) {
    console.error('Update member role error:', error);
    return c.json({ success: false, error: 'Failed to update member role' }, 500);
  }
});

// Remove member from clan
router.delete('/:id/members/:userId', async (c) => {
  try {
    const user = c.get('user');
    if (!user) {
      return c.json({ success: false, error: 'Unauthorized' }, 401);
    }
    
    const clanId = c.req.param('id');
    const targetUserId = c.req.param('userId');
    
    const clanService = new ClanService(c.env.DB, c.env.CACHE);
    
    // Check if user has permission to remove members
    const hasPermission = await clanService.checkUserPermission(clanId, user.id, 'moderator');
    if (!hasPermission) {
      return c.json({ success: false, error: 'Insufficient permissions' }, 403);
    }
    
    await clanService.removeMember(clanId, targetUserId);
    
    return c.json({
      success: true,
      message: 'Member removed successfully'
    });
  } catch (error) {
    console.error('Remove member error:', error);
    return c.json({ success: false, error: 'Failed to remove member' }, 500);
  }
});

// Get clan statistics
router.get('/:id/stats', async (c) => {
  try {
    const clanId = c.req.param('id');
    const timeframe = c.req.query('timeframe') || 'week';
    
    const clanService = new ClanService(c.env.DB, c.env.CACHE);
    const stats = await clanService.getClanStats(clanId, timeframe);
    
    return c.json({
      success: true,
      data: stats
    });
  } catch (error) {
    console.error('Get clan stats error:', error);
    return c.json({ success: false, error: 'Failed to fetch clan statistics' }, 500);
  }
});

// Search clans
router.get('/search', async (c) => {
  try {
    const query = c.req.query('q');
    if (!query) {
      return c.json({ success: false, error: 'Search query required' }, 400);
    }
    
    const page = parseInt(c.req.query('page') || '1');
    const limit = Math.min(parseInt(c.req.query('limit') || '20'), 100);
    
    const clanService = new ClanService(c.env.DB, c.env.CACHE);
    const result = await clanService.searchClans(query, page, limit);
    
    return c.json({
      success: true,
      clans: result.clans,
      pagination: {
        page,
        limit,
        total: result.total,
        hasMore: result.hasMore
      }
    });
  } catch (error) {
    console.error('Search clans error:', error);
    return c.json({ success: false, error: 'Failed to search clans' }, 500);
  }
});

export { router as clansRouter };