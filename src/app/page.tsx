'use client';
import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import {
  Heart, Calendar, Users, FileText, Pill,
  ArrowRight, AlertTriangle, Bot, Shield, Phone,
} from 'lucide-react';

const T = "'DM Mono',monospace";
const O = "'Outfit',sans-serif";
const P = "'Playfair Display',serif";


const FEATURES = [
  { icon: Pill, title: 'Medication Tracker', desc: 'Visual daily schedule with refill alerts, dosage history, and one-tap logging for the whole family to see.', color: '#7BC8A0' },
  { icon: Calendar, title: 'Shared Care Calendar', desc: 'Every appointment, lab, and therapy session in one place. Prep notes, directions, and post-visit summaries attached.', color: '#8060cc' },
  { icon: Users, title: 'Family Coordination', desc: 'Divide care duties fairly. Assign tasks by family member with priority levels, due dates, and completion tracking.', color: '#4ade80' },
  { icon: FileText, title: 'Secure Document Vault', desc: 'Insurance cards, legal docs, lab results, and care plans — organized and accessible when you need them most.', color: '#C07941' },
  { icon: Bot, title: 'AI Care Assistant', desc: 'Turn doctor visit notes into clear next steps. Draft family updates. Get proactive alerts about refills and follow-ups.', color: '#7BC8A0' },
  { icon: AlertTriangle, title: 'Emergency Profile', desc: 'One-tap access to conditions, medications, allergies, and emergency contacts — ready for first responders and ER staff.', color: '#E05C3A' },
];

function useInView(threshold = 0.12) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) setVisible(true); }, { threshold });
    obs.observe(el);
    return () => obs.disconnect();
  }, [threshold]);
  return [ref, visible] as const;
}

function FadeIn({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) {
  const [ref, visible] = useInView();
  return (
    <div ref={ref} style={{ opacity: visible ? 1 : 0, transform: visible ? 'translateY(0)' : 'translateY(24px)', transition: `opacity 0.7s ease ${delay}s, transform 0.7s ease ${delay}s` }}>
      {children}
    </div>
  );
}

export default function LandingPage() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileMenu, setMobileMenu] = useState(false);

  useEffect(() => {
    const h = () => setScrolled(window.scrollY > 40);
    window.addEventListener('scroll', h, { passive: true });
    return () => window.removeEventListener('scroll', h);
  }, []);

  return (
    <div style={{ background: '#0B1829', minHeight: '100vh', fontFamily: O, color: '#F4EDE1' }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,300;0,400;0,600;1,300;1,400&family=DM+Mono:wght@300;400;500&family=Outfit:wght@300;400;500;600;700&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        html{scroll-behavior:smooth}
        [id]{scroll-margin-top:80px}
        @keyframes pulse-dot{0%,100%{opacity:.6;transform:scale(1)}50%{opacity:1;transform:scale(1.2)}}
        @keyframes glow{0%,100%{text-shadow:0 0 20px rgba(123,200,160,.3)}50%{text-shadow:0 0 40px rgba(123,200,160,.6)}}
        .nav-link{color:#A8B8C8;text-decoration:none;font-size:13px;font-weight:600;letter-spacing:.5px;text-transform:uppercase;transition:color .2s;background:none;border:none;cursor:pointer;font-family:'Outfit',sans-serif}
        .nav-link:hover{color:#7BC8A0}
        .feature-card{background:rgba(255,255,255,.04);border:1px solid rgba(123,200,160,.14);border-radius:18px;padding:28px 24px;transition:all .25s}
        .feature-card:hover{transform:translateY(-4px);border-color:rgba(123,200,160,.3)}
        .problem-card{background:rgba(255,255,255,.04);border:1px solid rgba(123,200,160,.1);border-radius:16px;padding:24px;transition:all .2s}
        .problem-card:hover{border-color:rgba(123,200,160,.25)}
        .step-card{flex:1;padding:32px 24px;border-radius:18px;background:rgba(255,255,255,.04);border:1px solid rgba(123,200,160,.14);position:relative;counter-increment:step}
        .step-card::before{content:counter(step);font-family:'Playfair Display',serif;font-size:52px;font-weight:300;color:rgba(123,200,160,.1);position:absolute;top:16px;right:20px;line-height:1}
        @media(max-width:768px){
          .nav-desktop{display:none!important}
          .nav-mobile-btn{display:flex!important}
          .hero-section{padding:100px 20px 60px!important}
          .lp-section{padding:60px 20px!important}
          .features-grid{grid-template-columns:1fr!important}
          .steps-row{flex-direction:column!important}
          .problem-grid{grid-template-columns:1fr!important}
          .who-grid{grid-template-columns:1fr!important}
        }
      `}</style>

      {/* NAV */}
      <nav style={{ position:'fixed', top:0, left:0, right:0, zIndex:100, padding:scrolled?'12px 24px':'16px 24px', display:'flex', alignItems:'center', justifyContent:'space-between', background:scrolled?'rgba(11,24,41,.97)':'transparent', borderBottom:scrolled?'1px solid rgba(123,200,160,.14)':'1px solid transparent', backdropFilter:scrolled?'blur(20px)':'none', transition:'all .3s' }}>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <div style={{ width:34, height:34, borderRadius:10, background:'linear-gradient(135deg,#3D8B5E,#8060cc)', display:'flex', alignItems:'center', justifyContent:'center', boxShadow:'0 0 14px rgba(123,200,160,.3)' }}>
            <Heart size={16} color="#fff" fill="#fff" />
          </div>
          <div>
            <div style={{ fontFamily:P, fontSize:17, color:'#F4EDE1', lineHeight:1.1 }}>CareCircle</div>
            <div style={{ fontFamily:T, fontSize:8, color:'#C07941', letterSpacing:2, textTransform:'uppercase', marginTop:2 }}>Sovereign Edition</div>
          </div>
        </div>
        <div className="nav-desktop" style={{ display:'flex', gap:28, alignItems:'center' }}>
          <a href="#features" className="nav-link">Features</a>
          <a href="#how" className="nav-link">How It Works</a>
          <a href="#who" className="nav-link">Who It Is For</a>
          <Link href="/app" style={{ padding:'9px 22px', borderRadius:10, background:'linear-gradient(135deg,#7BC8A0,#3D8B5E)', color:'#0B1829', fontSize:13, fontWeight:700, textDecoration:'none' }}>Open App</Link>
        </div>
        <button className="nav-mobile-btn" style={{ display:'none', background:'none', border:'none', cursor:'pointer', flexDirection:'column', gap:5, padding:4 }} onClick={()=>setMobileMenu(!mobileMenu)}>
          <span style={{ display:'block', width:20, height:2, background:'#F4EDE1', borderRadius:2 }}/>
          <span style={{ display:'block', width:20, height:2, background:'#F4EDE1', borderRadius:2 }}/>
          <span style={{ display:'block', width:20, height:2, background:'#F4EDE1', borderRadius:2 }}/>
        </button>
      </nav>

      {mobileMenu && (
        <div style={{ position:'fixed', inset:0, background:'rgba(11,24,41,.98)', zIndex:99, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:32 }}>
          <a href="#features" className="nav-link" style={{ fontSize:18 }} onClick={()=>setMobileMenu(false)}>Features</a>
          <a href="#how" className="nav-link" style={{ fontSize:18 }} onClick={()=>setMobileMenu(false)}>How It Works</a>
          <a href="#who" className="nav-link" style={{ fontSize:18 }} onClick={()=>setMobileMenu(false)}>Who It Is For</a>
          <Link href="/app" style={{ padding:'14px 36px', borderRadius:12, background:'linear-gradient(135deg,#7BC8A0,#3D8B5E)', color:'#0B1829', fontSize:16, fontWeight:700, textDecoration:'none' }} onClick={()=>setMobileMenu(false)}>Open App</Link>
        </div>
      )}

      {/* HERO */}
      <section className="hero-section" style={{ minHeight:'100vh', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:'120px 24px 80px', textAlign:'center', position:'relative', overflow:'hidden' }}>
        <div style={{ position:'absolute', inset:0, background:'radial-gradient(ellipse 600px 400px at 20% 30%,rgba(123,200,160,.06),transparent),radial-gradient(ellipse 500px 500px at 80% 70%,rgba(128,96,204,.05),transparent)', pointerEvents:'none' }}/>
        <div style={{ position:'absolute', inset:0, opacity:.03, pointerEvents:'none' }}>
          <svg style={{ width:'100%', height:'100%' }} viewBox="0 0 800 600" preserveAspectRatio="xMidYMid slice">
            <defs><pattern id="hex" x="0" y="0" width="60" height="52" patternUnits="userSpaceOnUse"><polygon points="30,2 58,17 58,47 30,62 2,47 2,17" fill="none" stroke="#7BC8A0" strokeWidth=".7"/></pattern></defs>
            <rect width="800" height="600" fill="url(#hex)"/>
          </svg>
        </div>
        <FadeIn>
          <div style={{ display:'inline-flex', alignItems:'center', gap:8, padding:'7px 18px', borderRadius:24, background:'rgba(123,200,160,.08)', border:'1px solid rgba(123,200,160,.2)', fontSize:12, fontWeight:700, color:'#7BC8A0', marginBottom:28, fontFamily:T, letterSpacing:1, textTransform:'uppercase' }}>
            <div style={{ width:7, height:7, borderRadius:'50%', background:'#4ade80', animation:'pulse-dot 2s infinite' }}/>
            Free for Chickasaw families served by the Nation
          </div>
        </FadeIn>
        <FadeIn delay={0.1}>
          <h1 style={{ fontFamily:P, fontSize:'clamp(36px,6vw,68px)', fontWeight:300, lineHeight:1.1, letterSpacing:-1, maxWidth:800, marginBottom:24, color:'#F4EDE1' }}>
            Caring for your elder{' '}
            <em style={{ fontStyle:'italic', color:'#7BC8A0', animation:'glow 3s ease-in-out infinite' }}>just got easier</em>
          </h1>
        </FadeIn>
        <FadeIn delay={0.2}>
          <p style={{ fontSize:'clamp(15px,2.2vw,19px)', lineHeight:1.75, color:'#A8B8C8', maxWidth:580, marginBottom:40 }}>
            CareCircle Sovereign Edition is a free care coordination tool for Chickasaw families managing the health of an elder or loved one. One place for medications, appointments, tasks, and an AI assistant that keeps the whole family in the loop, with live data from Chikasha Health OS. Your family's information stays under Nation control.
          </p>
        </FadeIn>
        <FadeIn delay={0.3}>
          <div style={{ display:'flex', gap:12, flexWrap:'wrap', justifyContent:'center', marginBottom:48 }}>
            <Link href="/app" style={{ padding:'15px 32px', borderRadius:12, background:'linear-gradient(135deg,#7BC8A0,#3D8B5E)', color:'#0B1829', fontSize:15, fontWeight:700, textDecoration:'none', display:'inline-flex', alignItems:'center', gap:8, boxShadow:'0 0 24px rgba(123,200,160,.3)' }}>
              Get Started Free <ArrowRight size={18}/>
            </Link>
            <a href="#how" style={{ padding:'15px 32px', borderRadius:12, background:'transparent', color:'#F4EDE1', fontSize:15, fontWeight:700, textDecoration:'none', display:'inline-flex', alignItems:'center', gap:8, border:'1px solid rgba(123,200,160,.3)' }}>
              See How It Works
            </a>
          </div>
        </FadeIn>
        <FadeIn delay={0.4}>
          <div style={{ display:'flex', flexWrap:'wrap', justifyContent:'center', gap:24 }}>
            {[['🛡️','Sovereign Shield on'],['🏛️','Data stays with the Nation'],['📱','Works on any phone'],['👪','Share with family']].map(([ico,text],i)=>(
              <div key={i} style={{ display:'flex', alignItems:'center', gap:7, fontSize:13, color:'#A8B8C8' }}>
                <span>{ico}</span><span>{text}</span>
              </div>
            ))}
          </div>
        </FadeIn>
      </section>

      {/* PROBLEM */}
      <section className="lp-section" style={{ padding:'100px 24px' }}>
        <div style={{ maxWidth:1100, margin:'0 auto' }}>
          <FadeIn>
            <div style={{ fontFamily:T, fontSize:10, color:'#7BC8A0', textTransform:'uppercase', letterSpacing:3, marginBottom:12 }}>The Problem</div>
            <h2 style={{ fontFamily:P, fontSize:'clamp(26px,4vw,42px)', fontWeight:300, lineHeight:1.2, marginBottom:16, color:'#F4EDE1' }}>Caring for an elder is hard enough.<br/>The tools make it harder.</h2>
            <p style={{ fontSize:16, lineHeight:1.75, color:'#A8B8C8', maxWidth:580, marginBottom:48 }}>Chickasaw families carry the care of their elders across counties, shifts, and generations. Most are doing it on their phones with no support and no system.</p>
          </FadeIn>
          <div className="problem-grid" style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>
            {[
              { emoji:'💬', title:'Scattered group texts', text:'Critical updates buried in WhatsApp threads that nobody can find when they need them.' },
              { emoji:'💊', title:'Missed medications', text:"Nobody knows if Dad took his blood pressure pill this morning. Nobody wants to be the one who asks again." },
              { emoji:'📅', title:'Missed appointments', text:'Three siblings, one appointment, nobody remembered who was supposed to drive.' },
              { emoji:'🏥', title:'No one talks to each other', text:"The doctor says one thing, the pharmacy says another, and your family group chat has 200 unread messages." },
            ].map((item,i)=>(
              <FadeIn key={i} delay={i*0.08}>
                <div className="problem-card">
                  <div style={{ fontSize:28, marginBottom:14 }}>{item.emoji}</div>
                  <div style={{ fontWeight:600, fontSize:14, marginBottom:6, color:'#F4EDE1' }}>{item.title}</div>
                  <div style={{ fontSize:13, lineHeight:1.65, color:'#A8B8C8' }}>{item.text}</div>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* FEATURES */}
      <section id="features" style={{ padding:'100px 24px', background:'rgba(255,255,255,.02)', borderTop:'1px solid rgba(123,200,160,.08)', borderBottom:'1px solid rgba(123,200,160,.08)' }}>
        <div style={{ maxWidth:1100, margin:'0 auto' }}>
          <FadeIn>
            <div style={{ fontFamily:T, fontSize:10, color:'#7BC8A0', textTransform:'uppercase', letterSpacing:3, marginBottom:12 }}>Features</div>
            <h2 style={{ fontFamily:P, fontSize:'clamp(26px,4vw,42px)', fontWeight:300, lineHeight:1.2, marginBottom:16, color:'#F4EDE1' }}>Everything your family needs<br/>in one place</h2>
            <p style={{ fontSize:16, lineHeight:1.75, color:'#A8B8C8', maxWidth:540, marginBottom:48 }}>Built for real family caregivers: people working full time jobs, raising kids, and still showing up for their elders.</p>
          </FadeIn>
          <div className="features-grid" style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:16 }}>
            {FEATURES.map((f,i)=>(
              <FadeIn key={i} delay={i*0.06}>
                <div className="feature-card">
                  <div style={{ width:44, height:44, borderRadius:12, background:`${f.color}18`, border:`1px solid ${f.color}30`, display:'flex', alignItems:'center', justifyContent:'center', marginBottom:18 }}>
                    <f.icon size={20} color={f.color}/>
                  </div>
                  <div style={{ fontWeight:700, fontSize:14, marginBottom:8, color:'#F4EDE1' }}>{f.title}</div>
                  <div style={{ fontSize:13, lineHeight:1.65, color:'#A8B8C8' }}>{f.desc}</div>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section id="how" style={{ padding:'100px 24px' }}>
        <div style={{ maxWidth:1100, margin:'0 auto' }}>
          <FadeIn>
            <div style={{ fontFamily:T, fontSize:10, color:'#7BC8A0', textTransform:'uppercase', letterSpacing:3, marginBottom:12 }}>How It Works</div>
            <h2 style={{ fontFamily:P, fontSize:'clamp(26px,4vw,42px)', fontWeight:300, lineHeight:1.2, marginBottom:16, color:'#F4EDE1' }}>Up and running in 5 minutes</h2>
            <p style={{ fontSize:16, lineHeight:1.75, color:'#A8B8C8', maxWidth:480, marginBottom:48 }}>No training. No account setup calls. If you can send a text message you can use CareCircle.</p>
          </FadeIn>
          <div className="steps-row" style={{ display:'flex', gap:20, counterReset:'step' }}>
            {[
              { title:'Add your loved one', text:"Enter their medications, conditions, doctor names, and allergies. Takes about 3 minutes and you only do it once." },
              { title:'Request or accept access', text:"A family member requests access to the elder's Health OS, or the elder sends an invite. The elder approves and sets what each person can see." },
              { title:'Let CareCircle help', text:"Get reminders for medications, alerts for upcoming appointments, and an AI assistant that answers your questions any time." },
            ].map((s,i)=>(
              <FadeIn key={i} delay={i*0.12}>
                <div className="step-card">
                  <div style={{ fontWeight:700, fontSize:15, marginBottom:8, color:'#F4EDE1' }}>{s.title}</div>
                  <div style={{ fontSize:13, lineHeight:1.65, color:'#A8B8C8' }}>{s.text}</div>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* WHO IT IS FOR */}
      <section id="who" style={{ padding:'100px 24px' }}>
        <div style={{ maxWidth:1100, margin:'0 auto' }}>
          <FadeIn>
            <div style={{ fontFamily:T, fontSize:10, color:'#7BC8A0', textTransform:'uppercase', letterSpacing:3, marginBottom:12 }}>Who It Is For</div>
            <h2 style={{ fontFamily:P, fontSize:'clamp(26px,4vw,42px)', fontWeight:300, lineHeight:1.2, marginBottom:16, color:'#F4EDE1' }}>Built for families just like yours</h2>
            <p style={{ fontSize:16, lineHeight:1.75, color:'#A8B8C8', maxWidth:580, marginBottom:48 }}>
              CareCircle Sovereign Edition is designed for Chickasaw families managing the care of an elder or loved one served by the Nation. It is completely free to use.
            </p>
          </FadeIn>
          <div className="who-grid" style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:20, marginBottom:40 }}>
            {[
              { ico:'👵', title:'Caring for a parent', desc:'Mom has diabetes and high blood pressure. She sees three different doctors and takes six medications. CareCircle keeps it all in one place so nothing falls through the cracks.', color:'#7BC8A0' },
              { ico:'👨‍👩‍👧', title:'Families spread out', desc:"You live two hours away. Your sister lives across the country. CareCircle keeps everyone on the same page without the group chat chaos.", color:'#8060cc' },
              { ico:'🏥', title:'Chickasaw Nation patients', desc:'If your elder is a Chikasha Health OS patient, CareCircle shows the family the same live picture the elder sees, and alerts reach the family the moment a threshold is crossed.', color:'#4ade80' },
            ].map((w,i)=>(
              <FadeIn key={i} delay={i*0.1}>
                <div style={{ background:'rgba(255,255,255,.04)', border:`1px solid ${w.color}25`, borderRadius:18, padding:28, textAlign:'center' }}>
                  <div style={{ fontSize:40, marginBottom:14 }}>{w.ico}</div>
                  <div style={{ fontFamily:P, fontSize:17, color:'#F4EDE1', marginBottom:10 }}>{w.title}</div>
                  <div style={{ fontSize:13, color:'#A8B8C8', lineHeight:1.7 }}>{w.desc}</div>
                </div>
              </FadeIn>
            ))}
          </div>
          <FadeIn delay={0.2}>
            <div style={{ background:'rgba(74,222,128,.05)', border:'1px solid rgba(74,222,128,.2)', borderRadius:16, padding:'24px 28px', display:'flex', alignItems:'flex-start', gap:16 }}>
              <Shield size={24} color="#4ade80" style={{ flexShrink:0, marginTop:2 }}/>
              <div>
                <div style={{ fontSize:14, fontWeight:700, color:'#4ade80', marginBottom:6 }}>Your family&apos;s information is handled with care</div>
                <div style={{ fontSize:13, color:'#A8B8C8', lineHeight:1.7 }}>
                  Uploaded documents are encrypted (AES-256-GCM) at rest, access is role-scoped and audit-logged, and common identifiers like Social Security and phone numbers are redacted from AI prompts before they leave our servers. AI requests are processed by a third-party model provider over encrypted connections. We never sell your family&apos;s health information.
                </div>
              </div>
            </div>
          </FadeIn>
        </div>
      </section>

      {/* FINAL CTA */}
      <section style={{ textAlign:'center', padding:'100px 24px', background:'linear-gradient(135deg,rgba(123,200,160,.08),rgba(128,96,204,.06))', borderTop:'1px solid rgba(123,200,160,.14)', position:'relative', overflow:'hidden' }}>
        <div style={{ position:'absolute', inset:0, opacity:.025, pointerEvents:'none' }}>
          <svg style={{ width:'100%', height:'100%' }} viewBox="0 0 800 400" preserveAspectRatio="xMidYMid slice">
            <defs><pattern id="hex2" x="0" y="0" width="60" height="52" patternUnits="userSpaceOnUse"><polygon points="30,2 58,17 58,47 30,62 2,47 2,17" fill="none" stroke="#7BC8A0" strokeWidth=".7"/></pattern></defs>
            <rect width="800" height="400" fill="url(#hex2)"/>
          </svg>
        </div>
        <FadeIn>
          <h2 style={{ fontFamily:P, fontSize:'clamp(28px,5vw,48px)', fontWeight:300, lineHeight:1.15, letterSpacing:-1, maxWidth:600, margin:'0 auto 16px', color:'#F4EDE1', position:'relative' }}>
            Your elders took care of you.<br/>
            <em style={{ color:'#7BC8A0', fontStyle:'italic' }}>Now it&apos;s your turn.</em>
          </h2>
        </FadeIn>
        <FadeIn delay={0.1}>
          <p style={{ fontSize:17, color:'#A8B8C8', maxWidth:480, margin:'0 auto 36px', lineHeight:1.7, position:'relative' }}>
            Free for every Chickasaw family served by the Nation. No credit card. No signup fees. Just help.
          </p>
        </FadeIn>
        <FadeIn delay={0.2}>
          <div style={{ display:'flex', gap:12, justifyContent:'center', flexWrap:'wrap', position:'relative' }}>
            <Link href="/app" style={{ padding:'15px 36px', borderRadius:12, background:'linear-gradient(135deg,#7BC8A0,#3D8B5E)', color:'#0B1829', fontSize:15, fontWeight:700, textDecoration:'none', display:'inline-flex', alignItems:'center', gap:8, boxShadow:'0 0 24px rgba(123,200,160,.3)' }}>
              Get Started Free <ArrowRight size={18}/>
            </Link>
            <a href="tel:" style={{ padding:'15px 28px', borderRadius:12, background:'rgba(255,255,255,.06)', color:'#F4EDE1', fontSize:15, fontWeight:700, textDecoration:'none', display:'inline-flex', alignItems:'center', gap:8, border:'1px solid rgba(123,200,160,.2)' }}>
              <Phone size={16}/> Talk to someone
            </a>
          </div>
          <div style={{ fontFamily:T, fontSize:10, color:'#A8B8C8', marginTop:16, letterSpacing:1, position:'relative' }}>
            Free for Chickasaw families · Data stays with the Nation · Works on any device
          </div>
        </FadeIn>
      </section>

      {/* FOOTER */}
      <footer style={{ padding:'40px 24px 32px', borderTop:'1px solid rgba(123,200,160,.14)' }}>
        <div style={{ maxWidth:1100, margin:'0 auto', display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:16 }}>
          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
            <div style={{ width:28, height:28, borderRadius:8, background:'linear-gradient(135deg,#3D8B5E,#8060cc)', display:'flex', alignItems:'center', justifyContent:'center' }}>
              <Heart size={13} color="#fff" fill="#fff"/>
            </div>
            <div>
              <div style={{ fontFamily:P, fontSize:14, color:'#F4EDE1' }}>CareCircle Sovereign Edition</div>
              <div style={{ fontFamily:T, fontSize:9, color:'#A8B8C8', letterSpacing:1 }}>SOVEREIGN SHIELD TECHNOLOGIES LLC</div>
            </div>
          </div>
          <div style={{ fontSize:12, color:'#A8B8C8' }}>© 2026 Sovereign Shield Technologies LLC · Made with care for caregivers.</div>
          <div style={{ display:'flex', gap:24 }}>
            {['Privacy','Terms','HIPAA','Contact'].map(l=>(
              <button key={l} style={{ fontSize:12, color:'#A8B8C8', background:'none', border:'none', cursor:'pointer', fontFamily:O }}>{l}</button>
            ))}
          </div>
        </div>
      </footer>
    </div>
  );
}
