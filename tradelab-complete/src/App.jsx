import React, { useState, useEffect } from 'react'
import { supabase } from './utils/supabase'

const INITIAL_CASH = 1000

export default function App() {
  const [portfolios, setPortfolios] = useState({ claude: null, gabe: null })
  const [positions, setPositions] = useState({ claude: [], gabe: [] })
  const [trades, setTrades] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [tradeOwner, setTradeOwner] = useState('gabe')
  const [form, setForm] = useState({ symbol: '', action: 'BUY', quantity: '', price: '', reasoning: '' })

  useEffect(() => {
    loadData()
    const tradesChannel = supabase.channel('trades-channel')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'trades' }, () => loadData())
      .subscribe()
    return () => { supabase.removeChannel(tradesChannel) }
  }, [])

  const loadData = async () => {
    const [{ data: portfolioData }, { data: positionData }, { data: tradeData }] = await Promise.all([
      supabase.from('portfolios').select('*'),
      supabase.from('positions').select('*'),
      supabase.from('trades').select('*').order('created_at', { ascending: false }).limit(50)
    ])
    const p = { claude: null, gabe: null }
    portfolioData?.forEach(row => { p[row.owner] = row })
    setPortfolios(p)
    const pos = { claude: [], gabe: [] }
    positionData?.forEach(row => { pos[row.owner].push(row) })
    setPositions(pos)
    setTrades(tradeData || [])
    setLoading(false)
  }

  const calcValue = (owner) => {
    const cash = portfolios[owner]?.cash || INITIAL_CASH
    const posValue = positions[owner].reduce((sum, p) => sum + (p.quantity * p.avg_price), 0)
    return cash + posValue
  }

  const calcPnL = (owner) => calcValue(owner) - INITIAL_CASH
  const calcPnLPct = (owner) => (calcPnL(owner) / INITIAL_CASH * 100)
  const fmt = (v) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(v)
  const fmtTime = (t) => new Date(t).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })

  const submitTrade = async (e) => {
    e.preventDefault()
    const price = parseFloat(form.price)
    const quantity = parseInt(form.quantity)
    const symbol = form.symbol.toUpperCase().trim()
    if (!symbol || !price || !quantity) return alert('Fill all fields')
    const portfolio = portfolios[tradeOwner]
    if (form.action === 'BUY') {
      const cost = price * quantity
      if (cost > portfolio.cash) return alert(`Not enough cash! Need ${fmt(cost)}`)
      await supabase.from('portfolios').update({ cash: portfolio.cash - cost }).eq('owner', tradeOwner)
      const existing = positions[tradeOwner].find(p => p.symbol === symbol)
      if (existing) {
        const newQty = existing.quantity + quantity
        const newAvg = (existing.avg_price * existing.quantity + price * quantity) / newQty
        await supabase.from('positions').update({ quantity: newQty, avg_price: newAvg }).eq('id', existing.id)
      } else {
        await supabase.from('positions').insert({ owner: tradeOwner, symbol, quantity, avg_price: price })
      }
    } else {
      const existing = positions[tradeOwner].find(p => p.symbol === symbol)
      if (!existing || existing.quantity < quantity) return alert(`Don't have enough ${symbol}`)
      const proceeds = price * quantity
      await supabase.from('portfolios').update({ cash: portfolio.cash + proceeds }).eq('owner', tradeOwner)
      if (existing.quantity === quantity) {
        await supabase.from('positions').delete().eq('id', existing.id)
      } else {
        await supabase.from('positions').update({ quantity: existing.quantity - quantity }).eq('id', existing.id)
      }
    }
    await supabase.from('trades').insert({ owner: tradeOwner, symbol, action: form.action, quantity, price, reasoning: form.reasoning || 'No reasoning' })
    setShowModal(false)
    setForm({ symbol: '', action: 'BUY', quantity: '', price: '', reasoning: '' })
    loadData()
  }

  if (loading) return <div className="min-h-screen bg-slate-950 flex items-center justify-center text-cyan-400 text-xl">Loading...</div>

  const leader = calcValue('claude') > calcValue('gabe') ? 'claude' : calcValue('claude') < calcValue('gabe') ? 'gabe' : 'tie'

  return (
    <div className="min-h-screen bg-slate-950 text-gray-100 p-4 md:p-6">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <span className="text-3xl">📈</span>
            <div>
              <h1 className="text-2xl font-bold">TRADE<span className="text-cyan-400">LAB</span></h1>
              <p className="text-xs text-slate-500">$1K Challenge • Auto-Trading Active</p>
            </div>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-500/20 border border-emerald-500/30 rounded-full">
            <div className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse"></div>
            <span className="text-xs text-emerald-400">Claude Active</span>
          </div>
        </div>

        <div className={`p-4 rounded-xl border mb-6 ${leader === 'claude' ? 'bg-cyan-950/30 border-cyan-700' : leader === 'gabe' ? 'bg-amber-950/30 border-amber-700' : 'bg-slate-900 border-slate-700'}`}>
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-2">
              <span className="text-xl">{leader === 'claude' ? '🤖' : leader === 'gabe' ? '👤' : '🤝'}</span>
              <span className="font-bold capitalize">{leader === 'tie' ? "Tied!" : `${leader} leads`}</span>
            </div>
            <span className="font-bold">{fmt(Math.abs(calcValue('claude') - calcValue('gabe')))} spread</span>
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          {['claude', 'gabe'].map((owner) => (
            <div key={owner} className={`bg-slate-900 border rounded-xl overflow-hidden ${leader === owner ? (owner === 'claude' ? 'border-cyan-600' : 'border-amber-600') : 'border-slate-700'}`}>
              <div className={`p-4 border-b border-slate-800 ${owner === 'claude' ? 'bg-cyan-950/40' : 'bg-amber-950/40'}`}>
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    <span className="text-xl">{owner === 'claude' ? '🤖' : '👤'}</span>
                    <div>
                      <span className="font-bold capitalize">{owner}</span>
                      <p className="text-xs text-slate-500">{owner === 'claude' ? 'AI • Auto' : 'Human'}</p>
                    </div>
                  </div>
                  <span className={`px-2 py-0.5 rounded text-sm font-bold ${calcPnL(owner) >= 0 ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}`}>
                    {calcPnL(owner) >= 0 ? '+' : ''}{calcPnLPct(owner).toFixed(2)}%
                  </span>
                </div>
              </div>
              <div className="p-4">
                <div className="grid grid-cols-2 gap-2 mb-4">
                  <div className="bg-slate-950 rounded p-3">
                    <p className="text-xs text-slate-500">Value</p>
                    <p className="text-lg font-bold">{fmt(calcValue(owner))}</p>
                  </div>
                  <div className="bg-slate-950 rounded p-3">
                    <p className="text-xs text-slate-500">Cash</p>
                    <p className="text-lg font-bold text-slate-300">{fmt(portfolios[owner]?.cash || INITIAL_CASH)}</p>
                  </div>
                </div>
                <div className="flex justify-between items-center mb-2">
                  <span className="text-xs text-slate-500">POSITIONS</span>
                  {owner === 'gabe' && (
                    <button onClick={() => { setTradeOwner('gabe'); setShowModal(true) }} className="text-xs text-amber-400 hover:text-amber-300">+ New Trade</button>
                  )}
                </div>
                {positions[owner].length === 0 ? (
                  <p className="text-slate-600 text-sm text-center py-4">No positions</p>
                ) : (
                  <div className="space-y-2">
                    {positions[owner].map((pos) => (
                      <div key={pos.id} className="flex justify-between items-center bg-slate-950 rounded px-3 py-2">
                        <div>
                          <span className={`font-bold ${owner === 'claude' ? 'text-cyan-400' : 'text-amber-400'}`}>{pos.symbol}</span>
                          <span className="text-slate-500 text-sm ml-2">×{pos.quantity}</span>
                        </div>
                        <div className="text-right">
                          <p className="text-sm">{fmt(pos.avg_price)}</p>
                          <p className="text-xs text-slate-500">{fmt(pos.quantity * pos.avg_price)} total</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="bg-slate-900 border border-slate-700 rounded-xl">
          <div className="p-4 border-b border-slate-800 flex justify-between">
            <span className="font-bold">Trade History</span>
            <span className="text-slate-500 text-sm">{trades.length} trades</span>
          </div>
          <div className="max-h-80 overflow-y-auto divide-y divide-slate-800/50">
            {trades.length === 0 ? (
              <p className="text-slate-600 text-center py-8">No trades yet. Claude will start trading during market hours!</p>
            ) : trades.map((t) => (
              <div key={t.id} className="p-3">
                <div className="flex justify-between items-start">
                  <div className="flex items-center gap-2">
                    <span>{t.owner === 'claude' ? '🤖' : '👤'}</span>
                    <span className={`px-1.5 py-0.5 rounded text-xs font-bold ${t.action === 'BUY' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}`}>{t.action}</span>
                    <span>{t.quantity} <span className={t.owner === 'claude' ? 'text-cyan-400' : 'text-amber-400'}>{t.symbol}</span></span>
                    <span className="text-slate-500">@ {fmt(t.price)}</span>
                  </div>
                  <span className="text-xs text-slate-500">{fmtTime(t.created_at)}</span>
                </div>
                <p className="text-xs text-slate-500 mt-1 ml-7">{t.reasoning}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-900 border border-slate-600 rounded-xl w-full max-w-sm">
            <div className="p-4 border-b border-slate-700 flex justify-between">
              <span className="font-bold">👤 Log Your Trade</span>
              <button onClick={() => setShowModal(false)} className="text-slate-400 hover:text-white">✕</button>
            </div>
            <form onSubmit={submitTrade} className="p-4 space-y-3">
              <input type="text" placeholder="Symbol (AAPL)" value={form.symbol} onChange={(e) => setForm({...form, symbol: e.target.value.toUpperCase()})} className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 focus:outline-none focus:border-cyan-500" required />
              <div className="grid grid-cols-2 gap-2">
                <select value={form.action} onChange={(e) => setForm({...form, action: e.target.value})} className="bg-slate-950 border border-slate-700 rounded px-3 py-2">
                  <option value="BUY">BUY</option>
                  <option value="SELL">SELL</option>
                </select>
                <input type="number" placeholder="Qty" min="1" value={form.quantity} onChange={(e) => setForm({...form, quantity: e.target.value})} className="bg-slate-950 border border-slate-700 rounded px-3 py-2" required />
              </div>
              <input type="number" step="0.01" placeholder="Price" value={form.price} onChange={(e) => setForm({...form, price: e.target.value})} className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2" required />
              <input type="text" placeholder="Reasoning (optional)" value={form.reasoning} onChange={(e) => setForm({...form, reasoning: e.target.value})} className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2" />
              <button type="submit" className="w-full bg-amber-600 hover:bg-amber-500 py-2 rounded font-bold">Execute Trade</button>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
