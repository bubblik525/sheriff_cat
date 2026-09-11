import {validAddress} from './core.mjs';
const count=n=>Number.isSafeInteger(n)&&n>=0;
const quote=q=>q&&validAddress(q.address)&&Number.isFinite(q.price)&&q.price>0&&typeof q.pair==='string'&&q.pair.length>0&&count(q.observedAt);
export function validateState(s,demo){
 if(!s||s.version!==1||s.demo!==demo||!Array.isArray(s.tokens)||s.tokens.length>5000||!Array.isArray(s.games)||s.games.length>100||!s.watch||typeof s.watch!=='object'||Array.isArray(s.watch))return false;
 if(![s.cursor,s.start,s.lastScan].every(n=>n===null||count(n)))return false;
 if(s.cursor!==null&&s.start!==null&&s.start>s.cursor)return false;
 if(!s.tokens.every(t=>t&&validAddress(t.address)&&(!t.creator||validAddress(t.creator))&&typeof t.name==='string'&&typeof t.symbol==='string'&&count(t.block)&&count(t.seenAt)&&(!t.market||(typeof t.market==='object'&&['price','liquidity','volume','change','observedAt'].every(k=>t.market[k]==null||Number.isFinite(t.market[k]))))))return false;
 if(new Set(s.tokens.map(t=>t.address)).size!==s.tokens.length)return false;
 if(Object.keys(s.watch).length>100||!Object.entries(s.watch).every(([a,v])=>validAddress(a)&&v&&typeof v==='object'&&(v.price===null||Number.isFinite(v.price))))return false;
 return s.games.filter(g=>!g?.result).length<=1&&s.games.every(g=>g&&typeof g.id==='string'&&typeof g.symbol==='string'&&validAddress(g.address)&&['up','down'].includes(g.direction)&&quote(g.entry)&&g.entry.address===g.address&&count(g.due)&&(!g.result||['won','lost','draw','void'].includes(g.result))&&(!g.exit||quote(g.exit)));
}
