// Agentation (agentation.com): click any part of the app, write what should change, and the note
// reaches Claude Code through the agentation MCP server (`npx agentation-mcp server`, port 4747).
// Agentation is a React component, so React comes from a CDN just for this toolbar; the app itself
// doesn't use React. Only loaded on localhost (see the end of js/app.js).
import { createElement } from 'https://esm.sh/react@18.3.1';
import { createRoot } from 'https://esm.sh/react-dom@18.3.1/client?deps=react@18.3.1';
import { Agentation } from 'https://esm.sh/agentation@3.1.2?deps=react@18.3.1,react-dom@18.3.1';

const host = document.createElement('div');
host.id = 'agentation-root';
document.body.append(host);
createRoot(host).render(createElement(Agentation, { endpoint: 'http://localhost:4747' }));
