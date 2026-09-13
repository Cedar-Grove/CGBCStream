export default {
  async fetch(request, env) {
    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    const formData = await request.formData();
    const body = formData.get('Body') || '';
    const from = formData.get('From') || '';
    const text = body.toLowerCase();

    console.log('From:', from);
    console.log('Body:', body);
    console.log('Matched lightning alert:', text.includes('lightning alert'));
    console.log('Matched all clear:', text.includes('all clear'));

    const HA_BASE = 'https://assist.cedargroveleedsmedia.org/api/webhook';

    if (text.includes('all clear')) {
      await fetch(`${HA_BASE}/lightning-alert-clear`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'weathercall-sms' })
      });

    } else if (text.includes('lightning alert')) {
      await fetch(`${HA_BASE}/lightning-alert-active`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'weathercall-sms' })
      });
    }

    return new Response(
      `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`,
      { headers: { 'Content-Type': 'text/xml' } }
    );
  }
};
