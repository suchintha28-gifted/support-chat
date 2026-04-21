const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
app.use(express.json());
app.use(express.static('public'));

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

app.post('/chat', async (req, res) => {
  const { message, sessionId, lastEventId } = req.body;

  try {
    let currentSessionId = sessionId;
    if (!currentSessionId) {
      console.log('AGENT_ID:', JSON.stringify(process.env.AGENT_ID));
      console.log('ENVIRONMENT_ID:', JSON.stringify(process.env.ENVIRONMENT_ID));
      console.log('VAULT_ID:', JSON.stringify(process.env.VAULT_ID));

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
    }

    await client.beta.sessions.events.send(
      currentSessionId,
      { events: [{ type: 'user.message', content: [{ type: 'text', text: message }] }] },
      { headers: { 'anthropic-beta': 'managed-agents-2026-04-01' } }
    );

    let reply = '';
    let newLastEventId = lastEventId || null;

    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 3000));
      const params = newLastEventId ? { after_id: newLastEventId } : {};
      const events = await client.beta.sessions.events.list(
        currentSessionId,
        params,
        { headers: { 'anthropic-beta': 'managed-agents-2026-04-01' } }
      );

      if (events.data.length > 0) {
        newLastEventId = events.data[events.data.length - 1].id;
      }

      const idle = events.data.find(e => e.type === 'session.status_idle');
      const messages = events.data.filter(e => e.type === 'agent.message');

      if (idle && messages.length > 0) {
        reply = messages[messages.length - 1].content
          .filter(c => c.type === 'text')
          .map(c => c.text)
          .join('');
        break;
      }
    }

    res.json({ reply, sessionId: currentSessionId, lastEventId: newLastEventId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
