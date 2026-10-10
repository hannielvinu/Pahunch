// Compact route signature used by the language tests:
//   TL2 = take the 2nd left · P:temple = pass a temple · A:gate/blue opposite pharmacy = destination · F2 = floor
const lm = (l) => (l ? `${l.type}${l.colour ? `/${l.colour}` : ''}` : '-');
export const sig = (g) => [
  ...g.steps.map((s) => (s.kind === 'turn' ? `T${s.turn[0].toUpperCase()}${s.ordinal}`
    : `${s.kind === 'pass' ? 'P' : 'A'}:${lm(s.landmark)}${s.ref ? ` ${s.ref.relation} ${lm(s.ref.landmark)}` : ''}`)),
  ...(g.floor != null ? [`F${g.floor}`] : []),
].join(' | ');
