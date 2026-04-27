const express = require('express');
const app = express();
app.use(express.json());
app.use(express.static('public'));

const API_KEY = process.env.ANTHROPIC_API_KEY;
const HEADERS = {
  'Content-Type': 'application/json',
  'x-api-key': API_KEY,
  'anthropic-version': '2023-06-01',
  'anthropic-beta': 'managed-agents-2026-04-01',
};

async function apiPost(path, body) {
  const res = await fetch(\`https://api.anthropic.com\${path}\`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(\`POST \${path} failed: \${err}\`);
  }
  return res.json();
}

async function apiGet(path) {
  const res = await fetch(\`https://api.anthropic.com\${path}\`, {
    method: 'GET',
    headers: HEADERS,
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(\`GET \${path} failed: \${err}\`);
  }
  return res.json();
}

// Function to clean agent response - remove function calls and tool invocations
function cleanAgentResponse(text) {
  if (!text) return '';
  
  // Remove entire <function_calls>...</function_calls> blocks
  let cleaned = text.replace(/<function_calls>[\s\S]*?<\/function_calls>/g, '');
  
  // Remove standalone XML-like tags that might remain
  cleaned = cleaned.replace(/<\/?invoke[^>]*>/g, '');
  cleaned = cleaned.replace(/<\/?parameter[^>]*>/g, '');
  cleaned = cleaned.replace(/<\/?antml:[^>]*>/g, '');
  
  // Clean up extra whitespace and newlines
  cleaned = cleaned.replace(/\n\s*\n\s*\n/g, '\n\n'); // Remove triple+ newlines
  cleaned = cleaned.trim();
  
  return cleaned;
}

app.post('/chat', async (req, res) => {
  const { message, sessionId, eventCount } = req.body;

  try {
    let currentSessionId = sessionId;
    let knownEventCount = eventCount || 0;

    if (!currentSessionId) {
      const session = await apiPost('/v1/sessions', {
        agent: process.env.AGENT_ID,
        environment_id: process.env.ENVIRONMENT_ID,
        title: 'Gifted Support Chat',
      });
      currentSessionId = session.id;
      console.log('Created session:', currentSessionId);
    }

    await apiPost(\`/v1/sessions/\${currentSessionId}/events\`, {
      events: [{ type: 'user.message', content: [{ type: 'text', text: message }] }],
    });

    let reply = '';

    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 3000));

      const result = await apiGet(\`/v1/sessions/\${currentSessionId}/events?limit=100&order=asc\`);
      const allEvents = result.data;

      // only look at events we haven't seen before
      const newEvents = allEvents.slice(knownEventCount);

      console.log(\`Poll \${i}: \${allEvents.length} total, \${newEvents.length} new, types: \${newEvents.map(e => e.type).join(', ')}\`);

      const idle = newEvents.find(e => e.type === 'session.status_idle');
      const agentMessages = newEvents.filter(e => e.type === 'agent.message');

      if (idle && agentMessages.length > 0) {
        // Get the last agent message
        const lastMessage = agentMessages[agentMessages.length - 1];
        
        // Filter to ONLY text blocks (skip tool_use, tool_result, etc.)
        const textBlocks = lastMessage.content.filter(c => c.type === 'text');
        
        // Join all text blocks
        const rawReply = textBlocks.map(c => c.text).join('\n');
        
        // Clean the response - remove any function_calls XML that might be in the text
        reply = cleanAgentResponse(rawReply);
        
        knownEventCount = allEvents.length;
        break;
      }
    }

    console.log('Final reply:', reply || '(empty)');
    res.json({ reply, sessionId: currentSessionId, eventCount: knownEventCount });
  } catch (err) {
    console.error('ERROR:', err.message || err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(\`Server running on port \${PORT}\`));
