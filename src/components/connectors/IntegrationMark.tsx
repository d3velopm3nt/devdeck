import { BrandIcon } from '../BrandIcon'
import { GoogleMark } from '../GoogleMark'
import { Icon } from '../../lib/icons'

/** Local identification marks; existing GitHub/OpenAI/Google artwork is reused. */
export function IntegrationMark({ name }: { name: string }) {
  let mark
  switch (name) {
    case 'github': case 'openai': mark = <BrandIcon brand={name} size={33} />; break
    case 'google': mark = <GoogleMark size={35} />; break
    case 'anthropic': mark = <span className="connector-anthropic">AI</span>; break
    case 'vercel': mark = <svg viewBox="0 0 40 40" aria-hidden="true"><path fill="currentColor" d="M20 7 37 33H3Z" /></svg>; break
    case 'supabase': mark = <svg viewBox="0 0 40 40" aria-hidden="true"><path fill="#3ecf8e" d="M22 2 4 23a2 2 0 0 0 1.5 3H21Z" /><path fill="#22b77b" d="m18 38 18-21a2 2 0 0 0-1.5-3H19Z" /></svg>; break
    case 'microsoft': mark = <svg viewBox="0 0 40 40" aria-hidden="true"><path fill="#f25022" d="M4 4h15v15H4z"/><path fill="#7fba00" d="M21 4h15v15H21z"/><path fill="#00a4ef" d="M4 21h15v15H4z"/><path fill="#ffb900" d="M21 21h15v15H21z"/></svg>; break
    case 'slack': mark = <svg viewBox="0 0 40 40" aria-hidden="true"><g strokeWidth="7" strokeLinecap="round"><path stroke="#36c5f0" d="M7 17h9m0-10v1"/><path stroke="#2eb67d" d="M23 7v9m10 0h-1"/><path stroke="#ecb22e" d="M33 23h-9m0 10v-1"/><path stroke="#e01e5a" d="M17 33v-9M7 24h1"/></g></svg>; break
    case 'notion': mark = <svg viewBox="0 0 40 40" aria-hidden="true"><path d="m6 6 25-2 5 5v26L9 37l-5-5V8Z" fill="white"/><path d="M9 11h23v21H10Z" fill="#141414"/><text x="11" y="29" fill="white" fontFamily="Georgia,serif" fontWeight="bold" fontSize="24">N</text></svg>; break
    case 'linear': mark = <svg viewBox="0 0 40 40" aria-hidden="true"><defs><clipPath id="connector-linear-circle"><circle cx="20" cy="20" r="17"/></clipPath></defs><circle cx="20" cy="20" r="17" fill="#7865f6"/><g clipPath="url(#connector-linear-circle)" stroke="#0d1017" strokeWidth="2.4"><path d="m-4 14 30 30M0 7l33 33M4 0l38 38M14-4l30 30"/></g></svg>; break
    case 'facebook': mark = <svg viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="18" fill="#1687ff"/><path fill="white" d="M23 37V23h5l1-6h-6v-3c0-2 1-3 3-3h3V6l-5-1c-5 0-8 3-8 8v4h-5v6h5v14Z"/></svg>; break
    case 'instagram': mark = <svg viewBox="0 0 40 40" aria-hidden="true"><defs><linearGradient id="connector-instagram-gradient" x2="1" y2="1"><stop stopColor="#ffcd61"/><stop offset=".45" stopColor="#f32468"/><stop offset="1" stopColor="#8735d7"/></linearGradient></defs><rect x="3" y="3" width="34" height="34" rx="10" fill="url(#connector-instagram-gradient)"/><rect x="10" y="10" width="20" height="20" rx="6" fill="none" stroke="white" strokeWidth="2.5"/><circle cx="20" cy="20" r="5" fill="none" stroke="white" strokeWidth="2.5"/><circle cx="27" cy="13" r="1.5" fill="white"/></svg>; break
    case 'youtube': mark = <svg viewBox="0 0 40 40" aria-hidden="true"><rect x="2" y="8" width="36" height="25" rx="8" fill="#ff0033"/><path fill="white" d="m17 14 11 7-11 6Z"/></svg>; break
    case 'database': mark = <Icon name="database" size={30} />; break
    case 'mail': mark = <Icon name="mail" size={29} />; break
    case 'feed': mark = <svg viewBox="0 0 40 40" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true"><circle cx="9" cy="31" r="2" fill="currentColor" stroke="none"/><path d="M8 19a13 13 0 0 1 13 13M8 8a24 24 0 0 1 24 24"/></svg>; break
    default: mark = <Icon name="puzzle" size={29} />
  }
  return <span className="connector-mark" data-mark={name}>{mark}</span>
}
