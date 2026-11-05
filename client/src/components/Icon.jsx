const paths = {
  shield: ['M12 3 3.5 6v6c0 4.5 8.5 9 8.5 9s8.5-4.5 8.5-9V6L12 3Z', 'm8 12 2.5 2.5L16 9'],
  dashboard: ['M3 3h7v7H3z', 'M14 3h7v7h-7z', 'M3 14h7v7H3z', 'M14 14h7v7h-7z'],
  flag: ['m12 3 10 18H2L12 3Z', 'M12 9v4', 'M12 17h.01'],
  layers: ['m12 3 10 5-10 5L2 8l10-5Z', 'm2 12 10 5 10-5', 'm2 16 10 5 10-5'],
  user: ['M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z', 'M4 21v-2a8 8 0 0 1 16 0v2'],
  settings: ['M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z', 'm10 2-.5 3-2 .9-2.7-1.1-2 3.4L5 10v3l-2.2 1.8 2 3.4 2.7-1.1 2 .9.5 3h4l.5-3 2-.9 2.7 1.1 2-3.4L19 13v-3l2.2-1.8-2-3.4-2.7 1.1-2-.9-.5-3h-4Z'],
  logout: ['M9 3H4v18h5', 'M9 12h12', 'm17 8 4 4-4 4'],
  sun: ['M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z', 'M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5'],
  moon: ['M20.5 13.5A8.8 8.8 0 0 1 10.5 3 9 9 0 1 0 20.5 13.5Z'],
  arrow: ['M5 12h14', 'm13 6 6 6-6 6'],
  upload: ['M12 16V3', 'm7 8 5-5 5 5', 'M4 15v6h16v-6'],
  check: ['m5 12 4 4L19 6'],
  lock: ['M6 10h12v11H6z', 'M8 10V6a4 4 0 0 1 8 0v4'],
}

export default function Icon({ name, size = 20, className = '' }) {
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className={className}>{(paths[name] || paths.shield).map((d, i) => <path d={d} key={i} />)}</svg>
}
