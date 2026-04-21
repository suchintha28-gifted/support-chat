const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
app.use(express.json());
app.use(express.static('public'));

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

app.post('/chat', async (req, res) => {
  const { message, sessionId } = req.body;

  try {
    let currentSessionId = sessionId;
    if (!currentSessionId) {
      const session = await client.beta.sessions.create(
        {
          agent: process.env.AGENT_ID,
          environment_id: process.env.ENVIRONMENT_ID,
          vault_ids: process.env.VAULT_ID ? [process.env.VAULT_ID] : [],
          title: 'Customer Support Chat',
        },
        { headers: { 'anthropic-beta': 'managed-agents-2026-04-01' } }
      );
      currentSessionId = session.id;
      console.log('Created session:', currentSessionId);
    }

    await client.beta.sessions.events.send(
      currentSessionId,
      { events: [{ type: 'user.message', content: [{ type: 'text', text: message }] }] },
      { headers: { 'anthropic-beta': 'managed-agents-2026-04-01' } }
    );

    let reply = '';

    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 3000));

      const events = await client.beta.sessions.events.list(
        currentSessionId,
        { limit: 100, order: 'desc' },
        { headers: { 'anthropic-beta': 'managed-agents-2026-04-01' } }
      );

      console.log(`Poll ${i}: ${events.data.length} events, types: ${events.data.map(e => e.type).join(', ')}`);

      const idle = events.data.find(e => e.type === 'session.status_idle');
      const messages = events.data.filter(e => e.type === 'agent.message');

      if (idle && messages.length > 0) {
        reply = messages[0].content
          .filter(c => c.type === 'text')
          .map(c => c.text)
          .join('');
        break;
      }
    }

    console.log('Final reply:', reply || '(empty)');

    res.json({ reply, sessionId: currentSessionId });
  } catch (err) {
    console.error('ERROR:', err.message || err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
