import { extractChatText } from '../src/MinecraftBotManager';

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
console.log('Result string:', extractChatText(reason));