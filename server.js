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
  const res = await fetch(`https://api.anthropic.com${path}`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`POST ${path} failed: ${err}`);
  }
  return res.json();
}

async function apiGet(path) {
  const res = await fetch(`https://api.anthropic.com${path}`, {
    method: 'GET',
    headers: HEADERS,
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`GET ${path} failed: ${err}`);
  }
  return res.json();
}

// Function to clean agent response - remove function calls and tool invocations
function cleanAgentResponse(text) {
  if (!text) return '';
  
  // Remove entire <function_calls>...</function_calls> blocks
  let cleaned = text.replace(/<function_calls>[\s\S]*?<\/function_calls>/g, '');
  
  // Remove entire <tool_use>...</tool_use> blocks
  cleaned = cleaned.replace(/<tool_use>[\s\S]*?<\/tool_use>/g, '');
  
  // Remove all <*> tags (including nested content)
  cleaned = cleaned.replace(/<[^>]*>[\s\S]*?<\/antml:[^>]*>/g, '');
  cleaned = cleaned.replace(/<\/?antml:[^>]*>/g, '');
  
  // Remove standalone XML-like tags that might remain
  cleaned = cleaned.replace(/<\/?invoke[^>]*>/g, '');
  cleaned = cleaned.replace(/<\/?parameter[^>]*>/g, '');
  cleaned = cleaned.replace(/<\/?atml:[^>]*>/g, '');
  
  // Clean up extra whitespace and newlines
  cleaned = cleaned.replace(/\n\s*\n\s*\n/g, '\n\n');
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
        vault_ids: [process.env.VAULT_ID],  // ← ADDED THIS LINE
        title: 'Gifted Support Chat',
      });
      currentSessionId = session.id;
      console.log('Created session:', currentSessionId);
    }

    await apiPost(`/v1/sessions/${currentSessionId}/events`, {
      events: [{ type: 'user.message', content: [{ type: 'text', text: message }] }],
    });

    let reply = '';

    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 3000));

      const result = await apiGet(`/v1/sessions/${currentSessionId}/events?limit=100&order=asc`);
      const allEvents = result.data;

      const newEvents = allEvents.slice(knownEventCount);

      console.log(`Poll ${i}: ${allEvents.length} total, ${newEvents.length} new, types: ${newEvents.map(e => e.type).join(', ')}`);

      // Log tool-related events for debugging
      const toolUseEvents = newEvents.filter(e => e.type === 'agent.tool_use');
      const toolResultEvents = newEvents.filter(e => e.type === 'agent.tool_result');
      
      if (toolUseEvents.length > 0) {
        console.log(`🔧 TOOL USE DETECTED:`, JSON.stringify(toolUseEvents, null, 2));
      }
      
      if (toolResultEvents.length > 0) {
        console.log(`✅ TOOL RESULT DETECTED:`, JSON.stringify(toolResultEvents, null, 2));
      }

      const idle = newEvents.find(e => e.type === 'session.status_idle');
      const agentMessages = newEvents.filter(e => e.type === 'agent.message');

      // Only return when session is idle AND we have agent messages
      // This ensures we get ALL messages including tool results
      if (idle && agentMessages.length > 0) {
        // Get ALL agent messages from the entire session, not just new ones
        const allAgentMessages = allEvents.filter(e => e.type === 'agent.message');
        
        if (allAgentMessages.length > 0) {
          // Use the LAST agent message (most recent, includes tool results)
          const lastMessage = allAgentMessages[allAgentMessages.length - 1];
          
          const textBlocks = lastMessage.content.filter(c => c.type === 'text');
          
          const rawReply = textBlocks.map(c => c.text).join('\n');
          
          // TEMPORARY: Show raw output for debugging - remove cleanAgentResponse
          reply = rawReply;
          // reply = cleanAgentResponse(rawReply);
          
          console.log('TOTAL AGENT MESSAGES:', allAgentMessages.length);
          console.log('USING LAST MESSAGE (index:', allAgentMessages.length - 1, ')');
          console.log('RAW AGENT REPLY:', rawReply);
          console.log('FINAL REPLY TO USER:', reply);
          
          knownEventCount = allEvents.length;
          break;
        }
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
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
