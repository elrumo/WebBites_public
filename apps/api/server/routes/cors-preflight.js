// server/api/cors-preflight.js
export default defineEventHandler((event) => {
    // Get origin from request or use wildcard
    const origin = event.node.req.headers.origin || '*';
    const res = event.node.res;
    
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Max-Age', '86400');
    
    // Return 204 No Content
    res.statusCode = 204;
    res.end();
    return null;
  });