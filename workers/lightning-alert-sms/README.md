# lightning-alert-sms

Cloudflare Worker that receives the Twilio SMS webhook for the "WeatherCall" lightning
proximity alert texts and forwards them to Home Assistant webhooks.

It distinguishes the two message types by content:

- `8 mile Lightning Alert for New Lightning Proximity Alert ...` (strike detected) contains
  `lightning alert` → posts to `/api/webhook/lightning-alert-active`
- `All Clear Alert for New Lightning Proximity Alert ...` (no strikes in 20 min) contains
  `all clear` → posts to `/api/webhook/lightning-alert-clear`

## Deploy

```
cd workers/lightning-alert-sms
wrangler deploy
```

Point the Twilio SMS webhook for the WeatherCall number at this Worker's URL.
