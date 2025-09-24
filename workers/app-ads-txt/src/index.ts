// workers/app-ads-txt/src/index.ts
// Simple worker to serve app-ads.txt for AdMob verification

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    
    // Only respond to /app-ads.txt
    if (url.pathname === '/app-ads.txt') {
      // Your AdMob publisher ID content
      const content = 'google.com, pub-2967300488956409, DIRECT, f08c47fec0942fa0';
      
      return new Response(content, {
        status: 200,
        headers: {
          'Content-Type': 'text/plain',
          'Cache-Control': 'public, max-age=3600',
          // CORS headers in case needed
          'Access-Control-Allow-Origin': '*'
        }
      });
    }
    
    // Return 404 for other paths
    return new Response('Not Found', { status: 404 });
  }
};