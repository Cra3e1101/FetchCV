import React from 'react';
import {createRoot} from 'react-dom/client';
import '@fontsource/plus-jakarta-sans/400.css';
import '@fontsource/plus-jakarta-sans/500.css';
import '@fontsource/plus-jakarta-sans/600.css';
import '@fontsource/source-serif-4/400.css';
import '@fontsource/source-serif-4/500.css';
import '@fontsource/jetbrains-mono/400.css';
import '../../../src/styles.css';
import '../../../src/ui/workspace.css';
import '../../../src/ui/replica-alignment.css';
import '../../../src/ui/replica-components.css';
import {applyInterfaceTheme} from '../../../src/ui/interface-theme';
import {applyAppearance} from '../../../src/lib/appearance';
import {SourceReaderDialog} from '../../../src/components/InterviewSourceReader';

// Same production theme functions, CSS order and real component; no mocked API.
window.setFixtureTheme = (theme) => {
  applyInterfaceTheme(theme === 'dark' ? 'neutral-dark' : 'white');
  applyAppearance({theme});
};
window.setFixtureTheme('light');
createRoot(document.getElementById('root')).render(
  <SourceReaderDialog source={{id:'ui-source', title:'合成验收数据'}} onClose={() => {
    document.getElementById('root').dataset.closed = 'true';
  }} />,
);
