import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRoute,
} from '@tanstack/react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ThemeProvider } from '@/lib/theme'
import { HelpProvider } from '@/hooks/use-help'
import { HelpPanel } from '@/components/help/HelpPanel'
import { CustomCssStyles } from '@/components/settings/CustomCssPanel'
import { useCustomCss } from '@/lib/theme'
import appCss from '../styles.css?url'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5000,
    },
  },
})

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
      { title: 'Errata' },
    ],
    links: [
      { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
      { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
      { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossOrigin: 'anonymous' },
      { rel: 'stylesheet', href: appCss },
    ],
  }),
  component: RootComponent,
  shellComponent: RootDocument,
})

const themeScript = `(function(){var t=localStorage.getItem('errata-theme');var r=document.documentElement;r.classList.toggle('dark',t==='dark');r.classList.toggle('high-contrast',t==='high-contrast')})()`;
const fontScript = `(function(){var f=localStorage.getItem('errata-fonts');if(!f)return;try{var p=JSON.parse(f),s=document.documentElement.style,fb={display:', Georgia, serif',prose:', Georgia, serif',sans:', -apple-system, BlinkMacSystemFont, sans-serif',mono:', "Fira Code", Menlo, monospace'};for(var k in p){if(p[k]&&fb[k])s.setProperty('--font-'+k,'"'+p[k]+'"'+fb[k])}}catch(e){}})()`;

const fontLoaderScript = `(function(){
var defaults={display:'Instrument Serif',prose:'Newsreader',sans:'Outfit',mono:'JetBrains Mono'};
var specs={
'Instrument Serif':'ital@0;1',
'Playfair Display':'ital,wght@0,400..900;1,400..900',
'Cormorant Garamond':'ital,wght@0,300..700;1,300..700',
'Newsreader':'ital,opsz,wght@0,6..72,200..800;1,6..72,200..800',
'Literata':'ital,opsz,wght@0,7..72,200..900;1,7..72,200..900',
'Lora':'ital,wght@0,400..700;1,400..700',
'EB Garamond':'ital,wght@0,400..800;1,400..800',
'Outfit':'wght@300..700',
'DM Sans':'wght@300..700',
'Plus Jakarta Sans':'wght@300..700',
'Lexend':'wght@300..700',
'Atkinson Hyperlegible Next':'ital,wght@0,400..700;1,400..700',
'Atkinson Hyperlegible Mono':'ital,wght@0,400..700;1,400..700',
'JetBrains Mono':'wght@400;500',
'Fira Code':'wght@400;500',
'Source Code Pro':'wght@400;500'
};
var prefs={};
try{var raw=localStorage.getItem('errata-fonts');if(raw)prefs=JSON.parse(raw)}catch(e){}
var active=new Set();
for(var k in defaults){active.add(prefs[k]||defaults[k])}
var families=[];
active.forEach(function(name){
if(specs[name])families.push('family='+name.replace(/ /g,'+')+':'+specs[name])
});
if(!families.length)return;
var url='https://fonts.googleapis.com/css2?'+families.join('&')+'&display=swap';
var link=document.createElement('link');
link.rel='stylesheet';
link.href=url;
document.head.appendChild(link);
window.__errata_loaded_fonts=active;
})()`;

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <script dangerouslySetInnerHTML={{ __html: fontScript }} />
        <script dangerouslySetInnerHTML={{ __html: fontLoaderScript }} />
      </head>
      <body className="min-h-screen bg-background text-foreground antialiased">
        {children}
        <Scripts />
      </body>
    </html>
  )
}

function CustomCssProvider() {
  const [css, enabled] = useCustomCss()
  return <CustomCssStyles css={css} enabled={enabled} />
}

function RootComponent() {
  return (
    <ThemeProvider>
      <CustomCssProvider />
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <HelpProvider>
            <Outlet />
            <HelpPanel />
          </HelpProvider>
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  )
}
