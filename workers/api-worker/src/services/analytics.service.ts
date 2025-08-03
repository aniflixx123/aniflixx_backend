// workers/api-worker/src/services/analytics.service.ts

import { nanoid } from 'nanoid';

export class AnalyticsService {
  constructor(
    private db: D1Database,
    private viewerTracker: DurableObjectNamespace
  ) {}

  async trackView(flickId: string, userId: string | null, data: {
    duration: number;
    watchTime: number;
  }) {
    // Record view in analytics
    await this.db.prepare(`
      INSERT INTO flick_views (
        id, flick_id, user_id, duration, watch_time, 
        completion_rate, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(
      nanoid(),
      flickId,
      userId || null,
      data.duration,
      data.watchTime,
      data.duration ? (data.watchTime / data.duration) * 100 : 0,
      new Date().toISOString()
    ).run();

    // Update flick analytics
    await this.db.prepare(
      'UPDATE flick_analytics SET views = views + 1 WHERE flick_id = ?'
    ).bind(flickId).run();

    // Update average watch time and completion rate
    if (data.duration > 0) {
      const completionRate = (data.watchTime / data.duration) * 100;
      
      await this.db.prepare(`
        UPDATE flick_analytics 
        SET avg_watch_time = (
          SELECT AVG(watch_time) FROM flick_views WHERE flick_id = ?
        ),
        completion_rate = (
          SELECT AVG(completion_rate) FROM flick_views WHERE flick_id = ?
        )
        WHERE flick_id = ?
      `).bind(flickId, flickId, flickId).run();
    }
  }

  async getFlicksAnalytics(userId: string, period: string = '7d', flickId?: string) {
    let dateFilter = '';
    switch (period) {
      case '7d':
        dateFilter = "AND v.created_at >= datetime('now', '-7 days')";
        break;
      case '30d':
        dateFilter = "AND v.created_at >= datetime('now', '-30 days')";
        break;
    }

    // Get overall stats
    const overallStats = await this.db.prepare(`
      SELECT 
        COUNT(DISTINCT f.id) as totalFlicks,
        COALESCE(SUM(fa.views), 0) as totalViews,
        COALESCE(SUM(fa.likes), 0) as totalLikes,
        COALESCE(SUM(fa.comments), 0) as totalComments,
        COALESCE(SUM(fa.shares), 0) as totalShares,
        COALESCE(SUM(fa.saves), 0) as totalSaves
      FROM flicks f
      LEFT JOIN flick_analytics fa ON f.id = fa.flick_id
      WHERE f.user_id = ? AND f.status = 'active'
      ${flickId ? 'AND f.id = ?' : ''}
    `).bind(userId, ...(flickId ? [flickId] : [])).first();

    // Get views over time
    const viewsOverTime = await this.db.prepare(`
      SELECT 
        DATE(v.created_at) as date,
        COUNT(*) as views,
        AVG(v.watch_time) as avgWatchTime,
        AVG(v.completion_rate) as avgCompletionRate
      FROM flick_views v
      JOIN flicks f ON v.flick_id = f.id
      WHERE f.user_id = ? ${dateFilter}
      ${flickId ? 'AND f.id = ?' : ''}
      GROUP BY DATE(v.created_at)
      ORDER BY date DESC
    `).bind(userId, ...(flickId ? [flickId] : [])).all();

    // Get top performing flicks
    const topFlicks = await this.db.prepare(`
      SELECT 
        f.id,
        f.title,
        f.thumbnail_url,
        f.created_at,
        fa.views,
        fa.likes,
        fa.comments,
        fa.shares,
        fa.saves,
        (fa.likes + fa.comments * 2 + fa.shares * 3 + fa.saves * 2) as engagementScore
      FROM flicks f
      LEFT JOIN flick_analytics fa ON f.id = fa.flick_id
      WHERE f.user_id = ? AND f.status = 'active'
      ORDER BY engagementScore DESC
      LIMIT 10
    `).bind(userId).all();

    // Get engagement rate
    const engagementData = await this.db.prepare(`
      SELECT 
        f.id,
        fa.views,
        (fa.likes + fa.comments + fa.shares + fa.saves) as engagements
      FROM flicks f
      LEFT JOIN flick_analytics fa ON f.id = fa.flick_id
      WHERE f.user_id = ? AND f.status = 'active' AND fa.views > 0
    `).bind(userId).all();

    const avgEngagementRate = engagementData.results.length > 0
      ? engagementData.results.reduce((acc: number, flick: any) => {
          return acc + ((flick.engagements / flick.views) * 100);
        }, 0) / engagementData.results.length
      : 0;

    // Get audience demographics
    const audienceStats = await this.db.prepare(`
      SELECT 
        COUNT(DISTINCT v.user_id) as uniqueViewers,
        COUNT(CASE WHEN v.user_id IS NULL THEN 1 END) as anonymousViews,
        COUNT(CASE WHEN v.user_id IS NOT NULL THEN 1 END) as authenticatedViews
      FROM flick_views v
      JOIN flicks f ON v.flick_id = f.id
      WHERE f.user_id = ? ${dateFilter}
    `).bind(userId).first();

    return {
      overview: {
        totalFlicks: overallStats?.totalFlicks || 0,
        totalViews: overallStats?.totalViews || 0,
        totalLikes: overallStats?.totalLikes || 0,
        totalComments: overallStats?.totalComments || 0,
        totalShares: overallStats?.totalShares || 0,
        totalSaves: overallStats?.totalSaves || 0,
        avgEngagementRate: avgEngagementRate.toFixed(2) + '%',
      },
      viewsOverTime: viewsOverTime.results.map((row: any) => ({
        date: row.date,
        views: row.views,
        avgWatchTime: Math.round(row.avgWatchTime || 0),
        avgCompletionRate: (row.avgCompletionRate || 0).toFixed(2) + '%',
      })),
      topFlicks: topFlicks.results.map((flick: any) => ({
        id: flick.id,
        title: flick.title,
        thumbnailUrl: flick.thumbnail_url,
        createdAt: flick.created_at,
        stats: {
          views: flick.views || 0,
          likes: flick.likes || 0,
          comments: flick.comments || 0,
          shares: flick.shares || 0,
          saves: flick.saves || 0,
        },
        engagementScore: flick.engagementScore || 0,
      })),
      audience: {
        uniqueViewers: audienceStats?.uniqueViewers || 0,
        anonymousViews: audienceStats?.anonymousViews || 0,
        authenticatedViews: audienceStats?.authenticatedViews || 0,
      },
    };
  }

  async getRealtimeStats(userId: string) {
    // Get user's flicks
    const userFlicks = await this.db.prepare(
      'SELECT id FROM flicks WHERE user_id = ? AND status = ?'
    ).bind(userId, 'active').all();

    // Get live viewer counts from Durable Objects
    const realtimeStats = await Promise.all(
      userFlicks.results.map(async (flick: any) => {
        let viewers = 0;
        try {
          const id = this.viewerTracker.idFromName(flick.id);
          const obj = this.viewerTracker.get(id);
          const response = await obj.fetch(new Request('http://internal/count'));
          const data = await response.json() as any;
          viewers = data.count || 0;
        } catch (error) {
          console.error('Error fetching viewer count:', error);
        }

        return {
          flickId: flick.id,
          viewers,
        };
      })
    );

    const totalViewers = realtimeStats.reduce((sum, stat) => sum + stat.viewers, 0);

    return {
      totalViewers,
      flicks: realtimeStats.filter(stat => stat.viewers > 0),
      timestamp: new Date().toISOString(),
    };
  }

  async getTrendingHashtags(period: string = '7d') {
    let dateFilter = '';
    switch (period) {
      case '24h':
        dateFilter = "WHERE f.created_at >= datetime('now', '-1 day')";
        break;
      case '7d':
        dateFilter = "WHERE f.created_at >= datetime('now', '-7 days')";
        break;
      case '30d':
        dateFilter = "WHERE f.created_at >= datetime('now', '-30 days')";
        break;
    }

    // Get flicks with hashtags
    const flicksWithTags = await this.db.prepare(`
      SELECT 
        f.hashtags,
        fa.views,
        fa.likes,
        fa.comments,
        fa.shares,
        fa.saves
      FROM flicks f
      LEFT JOIN flick_analytics fa ON f.id = fa.flick_id
      ${dateFilter}
      ${dateFilter ? 'AND' : 'WHERE'} f.status = 'active' AND f.hashtags IS NOT NULL
    `).all();

    // Parse and aggregate hashtags
    const tagMap = new Map<string, { count: number; engagement: number; views: number }>();
    
    flicksWithTags.results.forEach((row: any) => {
      try {
        const tags = JSON.parse(row.hashtags);
        const engagement = (row.likes || 0) + (row.comments || 0) * 2 + (row.shares || 0) * 3 + (row.saves || 0) * 2;
        
        tags.forEach((tag: string) => {
          const existing = tagMap.get(tag) || { count: 0, engagement: 0, views: 0 };
          tagMap.set(tag, {
            count: existing.count + 1,
            engagement: existing.engagement + engagement,
            views: existing.views + (row.views || 0),
          });
        });
      } catch (e) {
        // Skip invalid JSON
      }
    });

    const sortedTags = Array.from(tagMap.entries())
      .map(([tag, data]) => ({
        tag,
        count: data.count,
        engagement: data.engagement,
        views: data.views,
        score: data.engagement + data.views * 0.1, // Weighted score
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 20);

    return sortedTags;
  }

  async getTrendingFlicks(period: string = '24h', limit: number = 20) {
    let dateFilter = '';
    switch (period) {
      case '1h':
        dateFilter = "AND f.created_at >= datetime('now', '-1 hour')";
        break;
      case '24h':
        dateFilter = "AND f.created_at >= datetime('now', '-1 day')";
        break;
      case '7d':
        dateFilter = "AND f.created_at >= datetime('now', '-7 days')";
        break;
    }

    const trending = await this.db.prepare(`
      SELECT 
        f.*,
        fa.views,
        fa.likes,
        fa.comments,
        fa.shares,
        fa.saves,
        u.is_verified,
        (
          fa.views * 0.1 + 
          fa.likes * 1 + 
          fa.comments * 2 + 
          fa.shares * 3 + 
          fa.saves * 2 +
          CASE WHEN f.created_at >= datetime('now', '-6 hours') THEN 50 ELSE 0 END
        ) as trendingScore
      FROM flicks f
      LEFT JOIN flick_analytics fa ON f.id = fa.flick_id
      LEFT JOIN users u ON f.user_id = u.id
      WHERE f.status = 'active' ${dateFilter}
      ORDER BY trendingScore DESC
      LIMIT ?
    `).bind(limit).all();

    return trending.results.map((flick: any) => ({
      id: flick.id,
      title: flick.title,
      thumbnailUrl: flick.thumbnail_url,
      views: flick.views || 0,
      likes: flick.likes || 0,
      trendingScore: flick.trendingScore,
      user: {
        id: flick.user_id,
        username: flick.username,
        isVerified: !!flick.is_verified,
      },
    }));
  }

  async getUserEngagementStats(userId: string, period: string = '30d') {
    let dateFilter = '';
    switch (period) {
      case '7d':
        dateFilter = "AND created_at >= datetime('now', '-7 days')";
        break;
      case '30d':
        dateFilter = "AND created_at >= datetime('now', '-30 days')";
        break;
    }

    // Get user's engagement stats
    const stats = await this.db.prepare(`
      SELECT 
        (SELECT COUNT(*) FROM flick_likes WHERE user_id = ? ${dateFilter}) as likesGiven,
        (SELECT COUNT(*) FROM flick_comments WHERE user_id = ? AND is_deleted = 0 ${dateFilter}) as commentsWritten,
        (SELECT COUNT(*) FROM flick_saves WHERE user_id = ? ${dateFilter}) as flicksSaved,
        (SELECT COUNT(*) FROM flick_views WHERE user_id = ? ${dateFilter}) as flicksWatched
    `).bind(userId, userId, userId, userId).first();

    // Get received engagement on user's flicks
    const received = await this.db.prepare(`
      SELECT 
        COALESCE(SUM(fa.likes), 0) as likesReceived,
        COALESCE(SUM(fa.comments), 0) as commentsReceived,
        COALESCE(SUM(fa.saves), 0) as savesReceived,
        COALESCE(SUM(fa.views), 0) as viewsReceived
      FROM flicks f
      LEFT JOIN flick_analytics fa ON f.id = fa.flick_id
      WHERE f.user_id = ?
    `).bind(userId).first();

    return {
      given: {
        likes: stats?.likesGiven || 0,
        comments: stats?.commentsWritten || 0,
        saves: stats?.flicksSaved || 0,
        views: stats?.flicksWatched || 0,
      },
      received: {
        likes: received?.likesReceived || 0,
        comments: received?.commentsReceived || 0,
        saves: received?.savesReceived || 0,
        views: received?.viewsReceived || 0,
      },
      period,
    };
  }
}