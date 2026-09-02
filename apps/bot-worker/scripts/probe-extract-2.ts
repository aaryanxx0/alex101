// Inline copy for debugging
function extractChatText(reason) {
  try {
    let parsed = reason;
    if (typeof parsed === 'string') {
      try { parsed = JSON.parse(parsed); } catch {}
    }
    if (!parsed || typeof parsed !== 'object') return '';
    const unwrap = (n) => {
      while (n && typeof n === 'object' && n.type && 'value' in n) {
        n = n.value;
      }
      return n;
    };
    let v = unwrap(parsed);
    console.log('  -> unwrapped v:', JSON.stringify(v).slice(0, 200));
    if (Array.isArray(v)) {
      let s = '';
      for (const c of v) s += extractChatText(c);
      return s;
    }
    if (!v || typeof v !== 'object') return typeof v === 'string' ? v : '';
    let out = '';
    if (typeof v.text === 'string') out += v.text;
    if (Array.isArray(v.extra)) {
      for (const c of v.extra) out += extractChatText(c);
    } else if (v.extra && typeof v.extra === 'object') {
      out += extractChatText(v.extra);
    }
    return out;
  } catch { return ''; }
}

const reason = {
  type: 'compound',
  value: {
    color: { type: 'string', value: 'red' },
    extra: {
      type: 'list',
      value: {
        type: 'compound',
        value: [{ translate: { type: 'string', value: 'multiplayer.disconnect.not_whitelisted' } }],
      },
    },
    text: { type: 'string', value: 'Unable to connect to survival: ' },
  },
};

console.log('Result:', JSON.stringify(extractChatText(reason)));
console.log('Result str:', extractChatText(reason));