import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function getQuote(symbol) {
  try {
    const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=1d`);
    const data = await res.json();
    const meta = data.chart.result[0].meta;
    return { price: meta.regularMarketPrice, change: ((meta.regularMarketPrice - meta.previousClose) / meta.previousClose * 100).toFixed(2) };
  } catch (e) { return null; }
}

export const handler = async (event, context) => {
  const now = new Date();
  const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const hour = et.getHours();
  const day = et.getDay();
  if (day === 0 || day === 6 || hour < 9 || hour >= 16) {
    return { statusCode: 200, body: JSON.stringify({ message: 'Market closed' }) };
  }

  try {
    const { data: portfolio } = await supabase.from('portfolios').select('*').eq('owner', 'claude').single();
    const { data: positions } = await supabase.from('positions').select('*').eq('owner', 'claude');
    const { data: recentTrades } = await supabase.from('trades').select('*').order('created_at', { ascending: false }).limit(10);

    const watchlist = ['NVDA', 'AMD', 'AAPL', 'MSFT', 'GOOGL', 'META', 'TSLA', 'AMZN', 'JPM', 'SPY'];
    const symbols = [...new Set([...watchlist, ...(positions?.map(p => p.symbol) || [])])];
    const quotes = {};
    for (const sym of symbols) { quotes[sym] = await getQuote(sym); }

    const prompt = `You are an AI paper trader in a $1,000 challenge against a human (Gabe). Trade wisely!

YOUR PORTFOLIO:
- Cash: $${portfolio?.cash || 1000}
- Positions: ${positions?.length ? positions.map(p => `${p.quantity} ${p.symbol} @ $${p.avg_price}`).join(', ') : 'None'}

MARKET DATA:
${Object.entries(quotes).filter(([,q]) => q).map(([s, q]) => `${s}: $${q.price} (${q.change}%)`).join('\n')}

RECENT TRADES:
${recentTrades?.slice(0, 5).map(t => `${t.owner}: ${t.action} ${t.quantity} ${t.symbol} @ $${t.price}`).join('\n') || 'None'}

RULES: Starting capital $1,000 each. Max 5 positions. No penny stocks. Be strategic.

Respond in JSON only:
{"action":"BUY"|"SELL"|"HOLD","symbol":"TICKER","quantity":number,"reasoning":"why"}`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 256,
      messages: [{ role: 'user', content: prompt }]
    });

    const text = response.content[0].text;
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return { statusCode: 200, body: JSON.stringify({ message: 'No valid response' }) };
    
    const decision = JSON.parse(match[0]);
    if (decision.action === 'HOLD') {
      return { statusCode: 200, body: JSON.stringify({ message: 'Holding', reasoning: decision.reasoning }) };
    }

    const quote = quotes[decision.symbol];
    if (!quote) return { statusCode: 200, body: JSON.stringify({ message: 'Invalid symbol' }) };
    const price = quote.price;

    if (decision.action === 'BUY') {
      const cost = price * decision.quantity;
      if (cost > portfolio.cash) return { statusCode: 200, body: JSON.stringify({ message: 'Not enough cash' }) };
      await supabase.from('portfolios').update({ cash: portfolio.cash - cost }).eq('owner', 'claude');
      const existing = positions?.find(p => p.symbol === decision.symbol);
      if (existing) {
        const newQty = existing.quantity + decision.quantity;
        const newAvg = (existing.avg_price * existing.quantity + price * decision.quantity) / newQty;
        await supabase.from('positions').update({ quantity: newQty, avg_price: newAvg }).eq('id', existing.id);
      } else {
        await supabase.from('positions').insert({ owner: 'claude', symbol: decision.symbol, quantity: decision.quantity, avg_price: price });
      }
    }

    if (decision.action === 'SELL') {
      const existing = positions?.find(p => p.symbol === decision.symbol);
      if (!existing || existing.quantity < decision.quantity) return { statusCode: 200, body: JSON.stringify({ message: 'Not enough shares' }) };
      await supabase.from('portfolios').update({ cash: portfolio.cash + (price * decision.quantity) }).eq('owner', 'claude');
      if (existing.quantity === decision.quantity) {
        await supabase.from('positions').delete().eq('id', existing.id);
      } else {
        await supabase.from('positions').update({ quantity: existing.quantity - decision.quantity }).eq('id', existing.id);
      }
    }

    await supabase.from('trades').insert({ owner: 'claude', symbol: decision.symbol, action: decision.action, quantity: decision.quantity, price: price, reasoning: decision.reasoning });
    return { statusCode: 200, body: JSON.stringify({ success: true, trade: decision }) };
  } catch (error) {
    console.error('Error:', error);
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }
};
