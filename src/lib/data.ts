export interface Medication {
  id: string;
  name: string;
  dose: string;
  schedule: string;
  time: string;
  taken: boolean;
  critical: boolean;
  pillsLeft: number;
  refillDate: string;
  notes?: string;
}

export interface Task {
  id: string;
  title: string;
  desc: string;
  due: string;
  done: boolean;
  priority: 'high' | 'medium' | 'low';
  assignee: string;
}

export interface Appointment {
  id: string;
  title: string;
  date: string;
  time: string;
  location: string;
  notes: string;
}

export interface FamilyMember {
  id: string;
  name: string;
  role: string;
  avatar: string;
  color: string;
  lastContact: string;
}

export interface Document {
  id: number;
  name: string;
  type: 'Medical' | 'Insurance' | 'Legal' | 'Care Plan';
  date: string;
  icon: string;
}

export interface EmergencyContact {
  name: string;
  relation: string;
  phone: string;
  medical?: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ShieldLog {
  ts: string;
  q: string;
  action: string;
  risk: string;
}

export interface FeedItem {
  who: string;
  action: string;
  what: string;
  time: string;
  avatar: string;
  color: string;
}

export const PATIENT = {
  name: 'Eleanor Culwell',
  short: 'Eleanor',
  age: 78,
  id: 'CC-ELEANOR-001',
  condition: 'Type 2 Diabetes, Hypertension, Mild Dementia',
  bloodType: 'O+',
  allergies: 'Penicillin, Sulfa drugs',
  provider: 'Dr. Maria Santos, MD',
  fqhc: 'Riverside Community Health Center',
  nextAppt: 'July 8, 2026',
  careiqScore: 62,
  careiqRisk: 'Moderate',
  trend: '+4.1% since last visit',
};

export const FAMILY: FamilyMember[] = [
  { id: 'sarah', name: 'Sarah Culwell', role: 'Primary Caregiver', avatar: 'SC', color: '#81B29A', lastContact: 'Today 9:14 AM' },
  { id: 'james', name: 'James Culwell', role: 'Son', avatar: 'JC', color: '#F2CC8F', lastContact: 'Yesterday' },
  { id: 'maria', name: 'Maria Lopez', role: 'Home Health Aide', avatar: 'ML', color: '#5B8FA8', lastContact: 'Today 8:00 AM' },
  { id: 'santos', name: 'Dr. Maria Santos', role: 'Primary Provider', avatar: 'MS', color: '#8B7EC8', lastContact: 'Apr 15' },
];

export const DEFAULT_MEDS: Medication[] = [
  { id: 'm1', name: 'Metformin 1000mg', dose: '1 tablet', schedule: '7:00 AM daily', time: '7:00 AM', taken: true, critical: true, pillsLeft: 28, refillDate: 'Apr 22', notes: 'Type 2 diabetes — take with food' },
  { id: 'm2', name: 'Lisinopril 10mg', dose: '1 tablet', schedule: '7:00 AM daily', time: '7:00 AM', taken: true, critical: true, pillsLeft: 12, refillDate: 'Apr 15', notes: 'ACE inhibitor — blood pressure' },
  { id: 'm3', name: 'Atorvastatin 40mg', dose: '1 tablet', schedule: '8:00 PM daily', time: '8:00 PM', taken: false, critical: false, pillsLeft: 22, refillDate: 'May 1' },
  { id: 'm4', name: 'Aspirin 81mg', dose: '1 tablet', schedule: '7:00 AM daily', time: '7:00 AM', taken: true, critical: false, pillsLeft: 45, refillDate: 'May 20' },
  { id: 'm5', name: 'Vitamin D3 2000IU', dose: '1 softgel', schedule: 'Morning with food', time: '7:00 AM', taken: false, critical: false, pillsLeft: 38, refillDate: 'May 12' },
  { id: 'm6', name: 'Amlodipine 5mg', dose: '1 tablet', schedule: '12:00 PM daily', time: '12:00 PM', taken: true, critical: true, pillsLeft: 6, refillDate: 'Apr 10', notes: 'Calcium channel blocker — may cause swelling' },
];

export const DEFAULT_TASKS: Task[] = [
  { id: 't1', title: 'Blood pressure check', desc: 'Check and log blood pressure before evening medications', due: 'Today 6:00 PM', done: false, priority: 'high', assignee: 'sarah' },
  { id: 't2', title: 'Transportation to lab', desc: 'Fasting labs at Riverside Community Health — arrive by 8:30 AM', due: 'Tomorrow 8:00 AM', done: false, priority: 'high', assignee: 'james' },
  { id: 't3', title: 'Refill Amlodipine', desc: 'Only 6 pills left — pickup at CVS on Main', due: 'Today', done: false, priority: 'high', assignee: 'sarah' },
  { id: 't4', title: 'Call insurance for prior auth', desc: 'Lisinopril dose increase requires prior authorization', due: 'This Week', done: false, priority: 'medium', assignee: 'sarah' },
  { id: 't5', title: 'Schedule ophthalmology referral', desc: 'Annual diabetic eye exam overdue by 3 months', due: 'This Week', done: false, priority: 'medium', assignee: 'james' },
  { id: 't6', title: 'Weekly weight log', desc: 'Log weight before breakfast — target under 165 lbs', due: 'Saturday AM', done: true, priority: 'low', assignee: 'maria' },
];

export const DEFAULT_APPOINTMENTS: Appointment[] = [
  { id: 'a1', title: 'Dr. Santos — Primary Care', date: 'Apr 28', time: '10:30 AM', location: 'Riverside Community Health', notes: 'Bring BP log, medication review' },
  { id: 'a2', title: 'Lab Work — A1C Panel', date: 'May 3', time: '7:00 AM', location: 'Quest Diagnostics on 5th', notes: 'Fasting required — no food after midnight' },
  { id: 'a3', title: 'Cardiology Follow-up', date: 'May 14', time: '2:00 PM', location: 'Heart & Vascular Center', notes: 'Discuss Amlodipine response' },
  { id: 'a4', title: 'Diabetic Eye Exam', date: 'May 16', time: '11:00 AM', location: 'Vision Care Associates', notes: 'Annual retinal screening — overdue' },
];

export const DOCUMENTS: Document[] = [
  { id: 1, name: 'Insurance Card — Blue Cross', type: 'Insurance', date: 'Current', icon: '🏥' },
  { id: 2, name: 'Medicare Part D Summary', type: 'Insurance', date: '2026', icon: '📋' },
  { id: 3, name: 'Power of Attorney', type: 'Legal', date: 'Jan 2024', icon: '⚖️' },
  { id: 4, name: 'Advance Directive', type: 'Legal', date: 'Jan 2024', icon: '📜' },
  { id: 5, name: 'Cardiology Notes — Mar 14', type: 'Medical', date: 'Mar 2026', icon: '❤️' },
  { id: 6, name: 'Lab Results — CBC Panel', type: 'Medical', date: 'Mar 2026', icon: '🔬' },
  { id: 7, name: 'Medication List (Master)', type: 'Medical', date: 'Updated Apr 1', icon: '💊' },
  { id: 8, name: 'Home Care Assessment', type: 'Care Plan', date: 'Feb 2026', icon: '🏠' },
];

export const EMERGENCY_CONTACTS: EmergencyContact[] = [
  { name: 'Eleanor Culwell', relation: 'Patient', phone: '(405) 555-0142', medical: 'Type 2 Diabetes, Hypertension, Mild Dementia' },
  { name: 'Sarah Culwell', relation: 'Primary Caregiver / POA', phone: '(405) 555-0188' },
  { name: 'Dr. Maria Santos', relation: 'Primary Care', phone: '(405) 555-0177' },
  { name: 'Riverside Community Health', relation: 'FQHC', phone: '(405) 555-0100' },
  { name: 'CVS Pharmacy on Main', relation: 'Pharmacy', phone: '(405) 555-0133' },
];

export const FEED_ITEMS: FeedItem[] = [
  { who: 'Sarah', action: 'logged', what: "Marked Eleanor's morning meds as taken (Lisinopril, Metformin, Aspirin)", time: '2h ago', avatar: 'S', color: '#81B29A' },
  { who: 'CareCircle AI', action: 'detected', what: 'Amlodipine refill needed in 4 days. Want me to call CVS?', time: '4h ago', avatar: '🤖', color: '#00d4b8' },
  { who: 'Maria Lopez', action: 'completed', what: 'Morning care visit and vitals — BP 138/86, weight 167 lbs', time: '8h ago', avatar: 'M', color: '#5B8FA8' },
  { who: 'James', action: 'scheduled', what: 'Confirmed lab transportation for Tuesday 7:00 AM', time: '1d ago', avatar: 'J', color: '#F2CC8F' },
  { who: 'Dr. Santos', action: 'reviewed', what: 'Lab results — A1C at 7.2% flagged for follow-up', time: 'Apr 15', avatar: 'MS', color: '#8B7EC8' },
];

export const AI_SUGGESTIONS = [
  { icon: '💊', text: 'Amlodipine refill needed in 4 days — want me to call CVS?', action: 'Refill Rx' },
  { icon: '📋', text: "Cardiology in 2 weeks — I've drafted a BP summary from this month's readings.", action: 'View Summary' },
  { icon: '👨‍👩‍👦', text: "James and Maria haven't been updated since Monday. Send a family update?", action: 'Draft Update' },
  { icon: '👁️', text: "Eleanor's eye exam is overdue 3 months. Want me to find available slots?", action: 'Find Appt' },
];

export const CAREIQ_DATA = [
  { label: 'Health Score', value: '62/100', color: '#d4a843', trend: 'down 4 pts' },
  { label: 'A1C', value: '7.2%', color: '#d4a843', trend: 'Elevated' },
  { label: 'BP', value: '138/86', color: '#d4a843', trend: 'Watch' },
  { label: 'LDL', value: '142 mg/dL', color: '#00d4b8', trend: 'In range' },
  { label: 'Care Gaps', value: '3 open', color: '#e8526e', trend: 'Critical' },
  { label: 'Med Adherence', value: '74%', color: '#d4a843', trend: 'Below target' },
];

export const CARE_GAPS = [
  { ico: '👁️', title: 'Diabetic Eye Exam', desc: 'Overdue 3 months. Referral needed.', severity: 'high' as const },
  { ico: '🦶', title: 'Podiatry Check', desc: 'Annual foot exam not on record.', severity: 'medium' as const },
  { ico: '💉', title: 'Flu Vaccine', desc: '2026 flu season vaccine not administered.', severity: 'medium' as const },
];

export const CAREIQ_VITALS = [
  { icon: '❤️', val: '138/86', unit: 'mmHg', name: 'Blood Pressure', status: 'warn' },
  { icon: '🩸', val: '7.2', unit: 'A1C %', name: 'Glycemic', status: 'warn' },
  { icon: '🔬', val: '142', unit: 'mg/dL', name: 'LDL Chol.', status: 'ok' },
  { icon: '⚡', val: '74', unit: 'bpm', name: 'Heart Rate', status: 'ok' },
];

export const CAREIQ_DOMAINS = [
  { name: 'Cardiovascular', score: 62, icon: '❤️' },
  { name: 'Metabolic', score: 58, icon: '🔬' },
  { name: 'Renal', score: 74, icon: '💧' },
  { name: 'Mental Health', score: 78, icon: '🧠' },
];

export const CAREIQ_PROTOCOLS = [
  { name: 'Diabetes Management', pct: 45, color: '#E07A5F', detail: 'A1C target 6.5% — Week 8 of 18' },
  { name: 'Cardiovascular Defense', pct: 32, color: '#D64045', detail: 'LDL target <130 mg/dL' },
  { name: 'Blood Pressure Control', pct: 67, color: '#5B8FA8', detail: 'Target <130/80 — Improving' },
];

export const CAREIQ_INSIGHTS = [
  {
    type: 'crit' as const,
    icon: '⚠️',
    title: 'A1C Trending Up — Diabetes Risk',
    body: "Eleanor's A1C of 7.2% has increased from 6.8% at last visit. CareIQ recommends medication review and dietary check-in within 14 days. Loop in the family care team.",
    conf: '94%',
  },
  {
    type: 'watch' as const,
    icon: '📈',
    title: 'BP Borderline — Monitor Closely',
    body: 'BP at 138/86 sits above target of 130/80. CareIQ flags this for attention. Ensure Lisinopril and Amlodipine schedules are being followed consistently.',
    conf: '89%',
  },
  {
    type: 'pos' as const,
    icon: '✅',
    title: 'Medication Adherence — Strong',
    body: 'CareCircle logs show morning medication adherence at 91% this month. This is directly contributing to cardiovascular stability. Keep up the great coordination.',
    conf: '97%',
  },
];

export const SHARED_FROM_FAMILY = [
  { icon: '💊', label: 'Medications Logged Today', val: '4 of 6', color: '#81B29A' },
  { icon: '📅', label: 'Next Family Appointment', val: 'Apr 28 — Dr. Santos', color: '#5B8FA8' },
  { icon: '✅', label: 'Open Care Tasks', val: '5 pending', color: '#E07A5F' },
  { icon: '👨‍👩‍👦', label: 'Active Caregivers', val: 'Sarah, James, Maria', color: '#8B7EC8' },
];

export const AI_RESPONSES: Record<string, string> = {
  'visit summary': `Here's a summary of Eleanor's last visit with Dr. Santos:

• BP was 138/86 — slightly above target
• A1C at 7.2% (up from 6.8%)
• Dr. Santos wants to review Amlodipine response next visit
• Recommended daily BP logging
• Follow-up scheduled for April 28

Want me to share this with Sarah and James?`,
  'family update': `Here's a draft update for the family:

"Hey everyone — quick update on Mom. Her primary care follow-up is 4/28 at 10:30 AM. BP has been trending high so Dr. Santos may adjust meds. Sarah, the prior auth on Lisinopril is in progress. James, thanks for handling lab transport. Maria's morning visits have been a big help. — Sarah"

Want me to send this, or edit first?`,
  'this week': `This week for Eleanor:

📅 Mon Apr 28 — Dr. Santos, Primary Care (10:30 AM)
  → Bring BP log, medication review

📅 Tue May 3 — Lab Work, A1C Panel (7:00 AM)
  → Fasting required, James handling transport

💊 Amlodipine refill needed by Apr 10 (6 pills left)

📋 5 open tasks across the family

Anything you want me to help prep?`,
  'default': `I can help with that. Here are some things I can do right now:

• Summarize visit notes and share with family
• Draft a family update message
• Check this week's schedule and tasks
• Prep for an upcoming appointment
• Look up medication interactions

Just let me know what you need!`,
};
