import next from 'eslint-config-next/core-web-vitals';

const eslintConfig = [
  { ignores: ['.next/**', 'out/**', 'node_modules/**', 'next-env.d.ts'] },
  ...next,
  {
    rules: {
      'react/no-unescaped-entities': 'off',
      // eslint-config-next 16 newly flags the standard
      // `useEffect(() => { refresh(); }, [refresh])` data-fetch-on-mount
      // pattern used across the pages here. That pattern is intentional, so
      // keep this rule off to preserve the pre-Next-16 lint behavior.
      'react-hooks/set-state-in-effect': 'off',
    },
  },
];

export default eslintConfig;
