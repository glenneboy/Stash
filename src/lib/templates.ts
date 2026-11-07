import type { Context, Profile, Task } from '../types';

// A starter checklist that can be installed as its own profile via `?template=<key>`.
export interface TemplateSection {
  tag: string;
  items: string[];
}

export interface Template {
  profileName: string;
  sections: TemplateSection[];
}

export const TEMPLATES: Record<string, Template> = {
  umrah: {
    profileName: 'Umrah',
    sections: [
      {
        tag: 'Before',
        items: [
          'Check passport validity (6+ months) and visa',
          'Book flights and hotels (Makkah and Madinah)',
          'Register on the Nusuk app and book permits',
          'Travel insurance and meningitis vaccination',
          'Learn the steps and duas of Umrah',
          'Settle debts and seek forgiveness',
          'Make a sincere intention (niyyah)',
        ],
      },
      {
        tag: 'Packing',
        items: [
          'Ihram clothing plus a spare set',
          'Ihram belt and unscented toiletries',
          'Comfortable sandals and a bag for them',
          'Dua book and prayer mat',
          'Medication, power bank, travel adaptor',
          'Water bottle for Zamzam',
        ],
      },
      {
        tag: 'Ihram',
        items: [
          'Shower (ghusl), trim nails, groom',
          'Put on ihram',
          'Pray 2 rakats of ihram',
          'Make niyyah at the miqat',
          'Recite the Talbiyah',
        ],
      },
      {
        tag: 'Tawaf',
        items: [
          'Enter Masjid al-Haram, right foot first',
          'Begin at the Black Stone line',
          'Complete 7 circuits',
          'Men: uncover right shoulder (idtiba) and walk briskly (raml) in the first 3',
          'Pray 2 rakats behind Maqam Ibrahim',
          'Drink Zamzam',
        ],
      },
      {
        tag: 'Sai',
        items: [
          'Start at Safa',
          'Complete 7 laps between Safa and Marwa',
          'Finish at Marwa',
        ],
      },
      {
        tag: 'Finish',
        items: [
          'Men: shave head (halq) or trim (taqsir)',
          'Women: trim a fingertip length of hair',
          'Umrah complete, ihram restrictions end',
          'Visit Madinah and pray in the Prophet\'s Mosque (optional)',
        ],
      },
    ],
  },
};

export interface BuiltTemplate {
  profile: Profile;
  contexts: Context[];
  tasks: Task[];
}

// Pure builder so it can be tested. Tasks list newest-first in the app, so earlier
// items get later timestamps to keep the checklist in reading order.
export function buildTemplate(template: Template, userId: string, now: Date = new Date()): BuiltTemplate {
  const profileId = crypto.randomUUID();
  const base = now.getTime();
  const profile: Profile = {
    id: profileId,
    name: template.profileName,
    created_at: new Date(base).toISOString(),
    user_id: userId,
  };
  const total = template.sections.reduce((n, s) => n + s.items.length, 0);
  const contexts: Context[] = template.sections.map((s, i) => ({
    id: crypto.randomUUID(),
    name: s.tag,
    created_at: new Date(base + i).toISOString(),
    profile_id: profileId,
  }));
  const tasks: Task[] = [];
  let n = 0;
  template.sections.forEach((s, si) => {
    s.items.forEach((title) => {
      tasks.push({
        id: crypto.randomUUID(),
        title,
        note: null,
        contexts: [contexts[si].id],
        completed: false,
        created_at: new Date(base + (total - n)).toISOString(),
        completed_at: null,
        due_on: null,
        reminder_at: null,
        notify_next_at: null,
        notify_stage: 0,
        recur: null,
        profile_id: profileId,
      });
      n += 1;
    });
  });
  return { profile, contexts, tasks };
}
