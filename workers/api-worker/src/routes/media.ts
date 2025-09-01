// workers/api-worker/src/routes/media.ts
// Optimal implementation using Cloudflare Images API

import { Hono } from 'hono';
import type { Env } from '../types';

type Variables = {
  user: {
    id: string;
    email: string;
    username: string;
  };
};

const mediaRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * Upload profile image using Cloudflare Images API
 * This is the RECOMMENDED approach for production
 */
mediaRouter.post('/upload/profile-image', async (c) => {
  try {
    const user = c.get('user');
    if (!user) {
      return c.json({ success: false, error: 'Unauthorized' }, 401);
    }

    console.log('📸 Starting profile image upload for user:', user.id);

    const formData = await c.req.formData();
    const fileEntry = formData.get('file');
    
    // Check if file exists and is actually a File object
    if (!fileEntry || typeof fileEntry === 'string') {
      return c.json({ success: false, error: 'No file provided' }, 400);
    }
    
    const file = fileEntry as File;

    // Validate file type
    const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];
    if (!validTypes.includes(file.type)) {
      return c.json({ 
        success: false, 
        error: 'Invalid file type. Accepted: JPEG, PNG, WebP, GIF' 
      }, 400);
    }

    // Validate file size (max 10MB for Cloudflare Images)
    const maxSize = 10 * 1024 * 1024; // 10MB
    if (file.size > maxSize) {
      return c.json({ 
        success: false, 
        error: 'File too large. Maximum size is 10MB.' 
      }, 400);
    }

    // Create form data for Cloudflare Images API
    const cfFormData = new FormData();
    cfFormData.append('file', file);
    
    // Add metadata
    cfFormData.append('metadata', JSON.stringify({
      userId: user.id,
      type: 'profile',
      uploadedAt: new Date().toISOString()
    }));
    
    // Set require signed URLs to false for public access
    cfFormData.append('requireSignedURLs', 'false');

    console.log('📤 Uploading to Cloudflare Images...');
    
    // Upload to Cloudflare Images
    const uploadResponse = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${c.env.CLOUDFLARE_ACCOUNT_ID}/images/v1`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${c.env.CLOUDFLARE_API_TOKEN}`,
        },
        body: cfFormData,
      }
    );

    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text();
      console.error('❌ Cloudflare Images upload failed:', errorText);
      
      // Check if Cloudflare Images is not enabled
      if (uploadResponse.status === 403) {
        return c.json({ 
          success: false, 
          error: 'Cloudflare Images is not enabled on this account. Please enable it in your Cloudflare dashboard.' 
        }, 503);
      }
      
      throw new Error(`Upload failed: ${errorText}`);
    }

    const uploadResult = await uploadResponse.json() as any;
    console.log('✅ Upload successful:', uploadResult);

    if (!uploadResult.success || !uploadResult.result) {
      throw new Error('Invalid response from Cloudflare Images');
    }

    // Get the image URL - Cloudflare Images provides multiple variants
    // Use the 'public' variant for profile images
    const imageUrl = uploadResult.result.variants?.[0] || 
                    `https://imagedelivery.net/${c.env.CLOUDFLARE_ACCOUNT_ID}/${uploadResult.result.id}/public`;

    // Update user's profile image in database
    const now = new Date().toISOString();
    await c.env.DB.prepare(
      'UPDATE users SET profile_image = ?, updated_at = ? WHERE id = ?'
    ).bind(imageUrl, now, user.id).run();
    
    // ADDED: Update profile image in all user's flicks
    console.log('📝 Updating profile image in all user flicks...');
    await c.env.DB.prepare(
      'UPDATE flicks SET profile_image = ?, updated_at = ? WHERE user_id = ?'
    ).bind(imageUrl, now, user.id).run();
    
    // Clear user cache
    await c.env.CACHE.delete(`user:${user.id}`);
    
    // ADDED: Clear user flicks cache
    await c.env.CACHE.delete(`user_flicks:${user.id}`);
    
    // Get updated user data
    const updatedUser = await c.env.DB.prepare(`
      SELECT id, email, username, profile_image, bio, 
             followers_count, following_count, is_verified
      FROM users WHERE id = ?
    `).bind(user.id).first();
    
    console.log('✅ Profile and flicks updated successfully');
    
    return c.json({
      success: true,
      data: {
        url: imageUrl,
        cloudflareImageId: uploadResult.result.id,
        user: updatedUser,
        variants: uploadResult.result.variants, // Different sizes available
        message: 'Profile image uploaded successfully'
      }
    });

  } catch (error: any) {
    console.error('❌ Media upload error:', error);
    return c.json({ 
      success: false, 
      error: error.message || 'Failed to upload image' 
    }, 500);
  }
});

/**
 * Alternative: Direct profile update with image URL
 * Use this if image is hosted elsewhere or for URL updates
 */
mediaRouter.put('/profile-image-url', async (c) => {
  try {
    const user = c.get('user');
    if (!user) {
      return c.json({ success: false, error: 'Unauthorized' }, 401);
    }

    const body = await c.req.json();
    const { imageUrl } = body;
    
    if (!imageUrl || typeof imageUrl !== 'string') {
      return c.json({ 
        success: false, 
        error: 'Invalid image URL' 
      }, 400);
    }

    // Validate URL format
    try {
      new URL(imageUrl);
    } catch {
      return c.json({ 
        success: false, 
        error: 'Invalid URL format' 
      }, 400);
    }

    // Update user's profile image
    const now = new Date().toISOString();
    await c.env.DB.prepare(
      'UPDATE users SET profile_image = ?, updated_at = ? WHERE id = ?'
    ).bind(imageUrl, now, user.id).run();
    
    // ADDED: Update profile image in all user's flicks
    console.log('📝 Updating profile image URL in all user flicks...');
    await c.env.DB.prepare(
      'UPDATE flicks SET profile_image = ?, updated_at = ? WHERE user_id = ?'
    ).bind(imageUrl, now, user.id).run();
    
    // Clear cache
    await c.env.CACHE.delete(`user:${user.id}`);
    
    // ADDED: Clear user flicks cache
    await c.env.CACHE.delete(`user_flicks:${user.id}`);
    
    return c.json({
      success: true,
      data: {
        url: imageUrl,
        message: 'Profile image URL updated successfully'
      }
    });

  } catch (error: any) {
    console.error('Profile image URL update error:', error);
    return c.json({ 
      success: false, 
      error: error.message || 'Failed to update profile image URL' 
    }, 500);
  }
});

/**
 * Delete profile image
 */
mediaRouter.delete('/profile-image', async (c) => {
  try {
    const user = c.get('user');
    if (!user) {
      return c.json({ success: false, error: 'Unauthorized' }, 401);
    }

    // Set profile image to null
    const now = new Date().toISOString();
    await c.env.DB.prepare(
      'UPDATE users SET profile_image = NULL, updated_at = ? WHERE id = ?'
    ).bind(now, user.id).run();
    
    // ADDED: Remove profile image from all user's flicks
    console.log('📝 Removing profile image from all user flicks...');
    await c.env.DB.prepare(
      'UPDATE flicks SET profile_image = NULL, updated_at = ? WHERE user_id = ?'
    ).bind(now, user.id).run();
    
    // Clear cache
    await c.env.CACHE.delete(`user:${user.id}`);
    
    // ADDED: Clear user flicks cache
    await c.env.CACHE.delete(`user_flicks:${user.id}`);
    
    return c.json({
      success: true,
      message: 'Profile image removed successfully'
    });

  } catch (error: any) {
    console.error('Delete profile image error:', error);
    return c.json({ 
      success: false, 
      error: error.message || 'Failed to delete profile image' 
    }, 500);
  }
});

/**
 * Generic upload endpoint for clan images (avatar/banner)
 * This can be used for any type of image upload
 */
mediaRouter.post('/upload/clan-image', async (c) => {
  try {
    const user = c.get('user');
    if (!user) {
      return c.json({ success: false, error: 'Unauthorized' }, 401);
    }

    console.log('📸 Starting clan image upload for user:', user.id);

    const formData = await c.req.formData();
    const fileEntry = formData.get('file');
    const imageType = formData.get('type') as string; // 'avatar' or 'banner'
    
    // Check if file exists and is actually a File object
    if (!fileEntry || typeof fileEntry === 'string') {
      return c.json({ success: false, error: 'No file provided' }, 400);
    }
    
    const file = fileEntry as File;

    // Validate file type
    const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];
    if (!validTypes.includes(file.type)) {
      return c.json({ 
        success: false, 
        error: 'Invalid file type. Accepted: JPEG, PNG, WebP, GIF' 
      }, 400);
    }

    // Validate file size (max 10MB for Cloudflare Images)
    const maxSize = 10 * 1024 * 1024; // 10MB
    if (file.size > maxSize) {
      return c.json({ 
        success: false, 
        error: 'File too large. Maximum size is 10MB.' 
      }, 400);
    }

    // Create form data for Cloudflare Images API
    const cfFormData = new FormData();
    cfFormData.append('file', file);
    
    // Add metadata
    cfFormData.append('metadata', JSON.stringify({
      userId: user.id,
      type: imageType || 'clan',
      uploadedAt: new Date().toISOString()
    }));
    
    // Set require signed URLs to false for public access
    cfFormData.append('requireSignedURLs', 'false');

    console.log('📤 Uploading to Cloudflare Images...');
    
    // Upload to Cloudflare Images
    const uploadResponse = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${c.env.CLOUDFLARE_ACCOUNT_ID}/images/v1`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${c.env.CLOUDFLARE_API_TOKEN}`,
        },
        body: cfFormData,
      }
    );

    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text();
      console.error('❌ Cloudflare Images upload failed:', errorText);
      
      // Check if Cloudflare Images is not enabled
      if (uploadResponse.status === 403) {
        return c.json({ 
          success: false, 
          error: 'Cloudflare Images is not enabled on this account. Please enable it in your Cloudflare dashboard.' 
        }, 503);
      }
      
      throw new Error(`Upload failed: ${errorText}`);
    }

    const uploadResult = await uploadResponse.json() as any;
    console.log('✅ Upload successful:', uploadResult);

    if (!uploadResult.success || !uploadResult.result) {
      throw new Error('Invalid response from Cloudflare Images');
    }

    // Get the image URL - use the 'public' variant
    const imageUrl = uploadResult.result.variants?.[0] || 
                    `https://imagedelivery.net/${c.env.CLOUDFLARE_ACCOUNT_ID}/${uploadResult.result.id}/public`;

    console.log('✅ Clan image uploaded successfully');
    
    return c.json({
      success: true,
      data: {
        url: imageUrl,
        cloudflareImageId: uploadResult.result.id,
        variants: uploadResult.result.variants, // Different sizes available
        message: 'Clan image uploaded successfully'
      }
    });

  } catch (error: any) {
    console.error('❌ Clan image upload error:', error);
    return c.json({ 
      success: false, 
      error: error.message || 'Failed to upload clan image' 
    }, 500);
  }
});

export { mediaRouter };