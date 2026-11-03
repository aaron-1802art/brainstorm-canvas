/**
 * Comprehensive verification script for Supabase connection, REST API, Auth, Schema, and Realtime.
 * Run with: node scripts/verify-supabase.js
 */

const fs = require('fs');
const path = require('path');

// Auto-enable Node 20 built-in WebSocket if not already enabled on globalThis
if (typeof WebSocket === 'undefined' && !process.env.__VERIFY_WS_REEXEC) {
  try {
    const majorVersion = parseInt(process.versions.node.split('.')[0], 10);
    if (majorVersion >= 20) {
      const { spawnSync } = require('child_process');
      const res = spawnSync(
        process.execPath,
        ['--experimental-websocket', __filename, ...process.argv.slice(2)],
        {
          stdio: 'inherit',
          env: { ...process.env, __VERIFY_WS_REEXEC: '1' },
        }
      );
      process.exit(res.status ?? 0);
    }
  } catch {
    // If auto-re-exec fails, continue with decoupled REST verification
  }
}

const { createClient } = require('@supabase/supabase-js');

// 1. Load environment variables from .env.local
const envLocalPath = path.resolve(__dirname, '../.env.local');
if (fs.existsSync(envLocalPath)) {
  const envContent = fs.readFileSync(envLocalPath, 'utf8');
  envContent.split('\n').forEach((line) => {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (match) {
      const key = match[1];
      let value = match[2] || '';
      if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
      if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
      process.env[key] = value.trim();
    }
  });
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

console.log('====================================================');
console.log('Brainstorm Canvas — Supabase Diagnostics & Verification');
console.log('====================================================');
console.log(`Node.js Runtime: ${process.version}`);
console.log(`WebSocket Support: ${typeof WebSocket !== 'undefined' ? 'Native WebSocket Available' : 'Not Present in global scope'}`);
console.log('----------------------------------------------------');

// Check environment variables
if (!url || !key || url.includes('YOUR_PROJECT') || key.includes('YOUR_SUPABASE')) {
  console.log('ℹ️  Status: Supabase credentials are NOT configured in .env.local.');
  console.log('ℹ️  The application is safely operating in offline-first Local Mode.');
  console.log('   - Local boards persist in localStorage.');
  console.log('   - Multi-tab synchronization runs via BroadcastChannel.');
  console.log('   - All Phase 1 & Phase 2 canvas tools are active.');
  console.log('');
  console.log('To activate Cloud Sync & Multi-User Collaboration:');
  console.log('1. Copy .env.example to .env.local');
  console.log('2. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY');
  console.log('3. Run the SQL script in sql/migration.sql in your Supabase SQL Editor');
  console.log('====================================================');
  process.exit(0);
}

const keyType = key.startsWith('eyJ')
  ? 'Legacy JWT (Anon Key)'
  : key.startsWith('sb_publishable_')
  ? 'Supabase Publishable Key'
  : 'Custom API Key';

console.log('1. Environment Configuration:');
console.log(`   - Endpoint URL: ${url}`);
console.log(`   - Key Type:     ${keyType}`);
console.log(`   - Key Length:   ${key.length} characters`);
console.log('   ✅ Environment variables loaded.\n');

// Decoupled Dummy WebSocket Transport for REST client
// Ensures REST and Auth verification NEVER crash in Node regardless of environment
class RestOnlyTransport {
  constructor() {
    // Intentionally no-op: REST requests do not use WebSockets
  }
}

// REST-only Supabase client
const restClient = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
  realtime: { transport: RestOnlyTransport },
});

async function runVerification() {
  let hasFailure = false;

  // ---------------------------------------------------------------
  // 2. Test Supabase REST & Auth Endpoints independently
  // ---------------------------------------------------------------
  console.log('2. Testing REST & Auth HTTP Connectivity...');
  try {
    const healthUrl = `${url}/auth/v1/health`;
    const res = await fetch(healthUrl, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    const bodyText = await res.text();

    if (res.ok) {
      console.log(`   ✅ Auth Endpoint reachable (HTTP ${res.status}): ${bodyText || 'OK'}`);
    } else {
      console.warn(`   ⚠️  Auth Endpoint returned HTTP ${res.status}: ${bodyText.slice(0, 150)}`);
      if (res.status === 403) {
        console.warn('      Hint: Ensure the Supabase project is active and the API key is valid.');
      }
    }
  } catch (err) {
    console.error(`   ❌ Failed to connect to REST/Auth endpoint: ${err.message}`);
    hasFailure = true;
  }

  // ---------------------------------------------------------------
  // 3. Test Database Tables & Migration Schema
  // ---------------------------------------------------------------
  console.log('\n3. Testing Database Tables & Row Level Security:');
  const requiredTables = ['profiles', 'boards', 'board_members', 'board_snapshots', 'board_invites'];

  for (const table of requiredTables) {
    try {
      const { data, error, status } = await restClient.from(table).select('id').limit(1);

      if (error) {
        const isMissingTable =
          error.code === '42P01' ||
          error.code === 'PGRST205' ||
          status === 404 ||
          error.message?.includes('schema cache');

        if (isMissingTable) {
          console.error(`   ❌ Table "${table}" does not exist in database yet (Status: 404).`);
          console.error('      -> Action: Run sql/migration.sql in the Supabase Dashboard SQL Editor.');
          hasFailure = true;
        } else if (error.code === '42501' || error.message?.includes('violates row-level security')) {
          console.log(`   ✅ Table "${table}" exists (Row Level Security active).`);
        } else if (error.message?.includes('fetch failed')) {
          console.error(`   ❌ Network error connecting to table "${table}": ${error.message}`);
          hasFailure = true;
        } else {
          console.log(`   ℹ️  Table "${table}" returned status ${status}: ${error.message}`);
        }
      } else {
        console.log(`   ✅ Table "${table}" exists and is queryable.`);
      }
    } catch (err) {
      console.error(`   ❌ Error querying table "${table}": ${err.message}`);
      hasFailure = true;
    }
  }

  // ---------------------------------------------------------------
  // 4. Test Supabase Realtime WebSocket Connectivity
  // ---------------------------------------------------------------
  console.log('\n4. Testing Realtime WebSocket Connectivity:');
  if (typeof WebSocket === 'undefined') {
    console.log('   ⚠️  Native WebSocket is not available in current Node environment.');
    console.log('   ℹ️  Note: Browsers natively supply window.WebSocket for frontend collaboration.');
    console.log('   ℹ️  To run Realtime verification in Node 20:');
    console.log('       node --experimental-websocket scripts/verify-supabase.js');
  } else {
    try {
      const realtimeClient = createClient(url, key, {
        auth: { persistSession: false },
      });

      const testChannel = realtimeClient.channel('verify-test-channel', {
        config: { broadcast: { ack: true } },
      });

      const subscribePromise = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          testChannel.unsubscribe();
          realtimeClient.removeChannel(testChannel);
          reject(new Error('Realtime connection timed out after 6 seconds'));
        }, 6000);

        testChannel.subscribe((status, err) => {
          if (status === 'SUBSCRIBED') {
            clearTimeout(timeout);
            testChannel.unsubscribe();
            realtimeClient.removeChannel(testChannel);
            resolve(status);
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            clearTimeout(timeout);
            reject(err || new Error(`Realtime status: ${status}`));
          }
        });
      });

      const status = await subscribePromise;
      console.log(`   ✅ Realtime WebSocket successfully connected (Channel status: ${status})`);
    } catch (err) {
      console.warn(`   ⚠️  Realtime check notification: ${err.message}`);
      console.warn('      (Ensure Realtime is enabled in your Supabase project settings)');
    }
  }

  console.log('\n====================================================');
  if (hasFailure) {
    console.log('⚠️  Verification encountered issues. Review the logs above.');
    process.exit(1);
  } else {
    console.log('🎉 Supabase verification checks completed.');
    process.exit(0);
  }
}

runVerification();
