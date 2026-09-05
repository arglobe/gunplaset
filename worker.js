// ==============================================================================
// GunplaSet Cloudflare Worker Backend API
// Security: Zero-Tolerance Security Protocol, Google JWT Signature Verification,
//           Strict Prepared Statements (No SQLi), IDOR Protection.
// ==============================================================================

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// Google Token Verification (Server-Side Signature Check)
async function verifyGoogleToken(idToken) {
  if (!idToken || typeof idToken !== 'string') return null;
  try {
    const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`);
    if (!res.ok) return null;
    const payload = await res.json();
    // Validate required fields from Google
    if (!payload.sub || !payload.aud) return null;
    return {
      userId: payload.sub,
      email: payload.email || '',
      name: payload.name || '',
      picture: payload.picture || ''
    };
  } catch (err) {
    console.error('Google Token Verification Error:', err);
    return null;
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // 1. CORS Preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    // 2. Health & Security Status Check
    if (url.pathname === '/api/health') {
      return new Response(JSON.stringify({ status: 'ok', time: new Date().toISOString() }), {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
      });
    }

    // 3. User Authentication & Onboarding (POST /api/auth/google)
    if (url.pathname === '/api/auth/google' && request.method === 'POST') {
      try {
        const body = await request.json();
        const verifiedUser = await verifyGoogleToken(body.id_token);
        if (!verifiedUser) {
          return new Response(JSON.stringify({ error: 'Unauthorized: Invalid Google Token' }), {
            status: 401,
            headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
          });
        }

        // Check if user already exists
        const existing = await env.DB.prepare(
          'SELECT user_id, country, region, age_group, gender FROM users WHERE user_id = ?'
        ).bind(verifiedUser.userId).first();

        // If new onboarding profile provided
        if (body.onboarding) {
          const { country = 'KR', region = '', age_group = '30s', gender = 'U' } = body.onboarding;
          await env.DB.prepare(`
            INSERT INTO users (user_id, email, country, region, age_group, gender, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(user_id) DO UPDATE SET
              country = excluded.country,
              region = excluded.region,
              age_group = excluded.age_group,
              gender = excluded.gender,
              updated_at = CURRENT_TIMESTAMP
          `).bind(verifiedUser.userId, verifiedUser.email, country, region, age_group, gender).run();
        } else if (!existing) {
          // Default profile if not onboarded yet
          await env.DB.prepare(`
            INSERT INTO users (user_id, email, country, region, age_group, gender)
            VALUES (?, ?, 'KR', '', '30s', 'U')
          `).bind(verifiedUser.userId, verifiedUser.email).run();
        }

        // Fetch user profile
        const profile = await env.DB.prepare(
          'SELECT user_id, email, country, region, age_group, gender FROM users WHERE user_id = ?'
        ).bind(verifiedUser.userId).first();

        return new Response(JSON.stringify({ success: true, profile, user: verifiedUser }), {
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: 'Internal Server Error', detail: e.message }), {
          status: 500,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
        });
      }
    }

    // 4. Get User Collection (GET /api/collection)
    if (url.pathname === '/api/collection' && request.method === 'GET') {
      const authHeader = request.headers.get('Authorization') || '';
      const token = authHeader.replace(/^Bearer\s+/i, '');
      const verifiedUser = await verifyGoogleToken(token);
      if (!verifiedUser) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
        });
      }

      const row = await env.DB.prepare(
        'SELECT collection_data, total_owned_count, wishlist_count, updated_at FROM user_collections WHERE user_id = ?'
      ).bind(verifiedUser.userId).first();

      return new Response(JSON.stringify({
        success: true,
        collection: row ? JSON.parse(row.collection_data) : {},
        updatedAt: row ? row.updated_at : null
      }), {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
      });
    }

    // 5. Sync User Collection (POST /api/collection/sync) - IDOR Immune
    if (url.pathname === '/api/collection/sync' && request.method === 'POST') {
      const authHeader = request.headers.get('Authorization') || '';
      const token = authHeader.replace(/^Bearer\s+/i, '');
      const verifiedUser = await verifyGoogleToken(token);
      if (!verifiedUser) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
        });
      }

      try {
        const body = await request.json();
        const collection = body.collection || {};
        const collectionJson = JSON.stringify(collection);

        let totalOwned = 0;
        let wishlistCount = 0;
        for (const k in collection) {
          const item = collection[k];
          if (item) {
            const b = item.backlog || 0;
            const p = item.inProgress || 0;
            const u = item.built || 0;
            if (b + p + u > 0) totalOwned += (b + p + u);
            if (item.wishlist) wishlistCount++;
          }
        }

        await env.DB.prepare(`
          INSERT INTO user_collections (user_id, collection_data, total_owned_count, wishlist_count, updated_at)
          VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(user_id) DO UPDATE SET
            collection_data = excluded.collection_data,
            total_owned_count = excluded.total_owned_count,
            wishlist_count = excluded.wishlist_count,
            updated_at = CURRENT_TIMESTAMP
        `).bind(verifiedUser.userId, collectionJson, totalOwned, wishlistCount).run();

        return new Response(JSON.stringify({ success: true, totalOwned, wishlistCount }), {
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: 'Sync Failed', detail: e.message }), {
          status: 500,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
        });
      }
    }

    // 6. Global Big Data Stats (GET /api/stats/rankings)
    if (url.pathname === '/api/stats/rankings' && request.method === 'GET') {
      try {
        const totalUsersRow = await env.DB.prepare('SELECT COUNT(*) as count FROM users').first();
        const countryStats = await env.DB.prepare(`
          SELECT country, COUNT(*) as count FROM users GROUP BY country ORDER BY count DESC LIMIT 10
        `).all();
        const ageStats = await env.DB.prepare(`
          SELECT age_group, COUNT(*) as count FROM users GROUP BY age_group ORDER BY count DESC
        `).all();

        return new Response(JSON.stringify({
          success: true,
          totalUsers: totalUsersRow ? totalUsersRow.count : 0,
          countryDistribution: countryStats.results || [],
          ageDistribution: ageStats.results || []
        }), {
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: 'Failed to fetch rankings', detail: e.message }), {
          status: 500,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
        });
      }
    }

    // Default 404
    return new Response(JSON.stringify({ error: 'Endpoint Not Found' }), {
      status: 404,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
    });
  }
};
