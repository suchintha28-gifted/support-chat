const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
app.use(express.json());
app.use(express.static('public'));

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

app.post('/chat', async (req, res) => {
  const { message, sessionId } = req.body;

  try {
    // If no session exists, create one
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
    }

    // Send the user message
    await client.beta.sessions.events.send(
      currentSessionId,
      { events: [{ type: 'user.message', content: [{ type: 'text', text: message }] }] },
      { headers: { 'anthropic-beta': 'managed-agents-2026-04-01' } }
    );

    // Poll for the agent's reply
    let reply = '';
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 2000));
      const events = await client.beta.sessions.events.list(
        currentSessionId,
        {},
        { headers: { 'anthropic-beta': 'managed-agents-2026-04-01' } }
      );
      const messages = events.data.filter(e => e.type === 'agent.message');
      if (messages.length > 0) {
        reply = messages[messages.length - 1].content.map(c => c.text).join('');
        break;
      }
    }

    res.json({ reply, sessionId: currentSessionId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
