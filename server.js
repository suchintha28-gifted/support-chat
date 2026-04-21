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

app.post('/chat', async (req, res) => {
  const { message, sessionId, eventCount } = req.body;

  try {
    let currentSessionId = sessionId;
    let knownEventCount = eventCount || 0;

    if (!currentSessionId) {
      const session = await apiPost('/v1/sessions', {
        agent: process.env.AGENT_ID,
        environment_id: process.env.ENVIRONMENT_ID,
        vault_ids: process.env.VAULT_ID ? [process.env.VAULT_ID] : [],
        title: 'Customer Support Chat',
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

      // only look at events we haven't seen before
      const newEvents = allEvents.slice(knownEventCount);

      console.log(`Poll ${i}: ${allEvents.length} total, ${newEvents.length} new, types: ${newEvents.map(e => e.type).join(', ')}`);

      const idle = newEvents.find(e => e.type === 'session.status_idle');
      const agentMessages = newEvents.filter(e => e.type === 'agent.message');

      if (idle && agentMessages.length > 0) {
        reply = agentMessages[agentMessages.length - 1].content
          .filter(c => c.type === 'text')
          .map(c => c.text)
          .join('');
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
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
