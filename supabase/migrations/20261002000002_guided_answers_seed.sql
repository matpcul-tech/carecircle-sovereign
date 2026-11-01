-- Seed: Guided Answers starter content
--
-- Every row lands as status = 'draft' (the column default) and is therefore
-- invisible to the client until a person reviews it and flips it to
-- 'approved'. Nothing here reaches a family member on deploy.
--
-- Scope is lifestyle and longevity only: general wellness habits. No
-- dosing, no diagnosis, no treatment guidance. Each answer defers to the
-- reader's own care team, and the UI adds a standing disclaimer footer.
--
-- BEFORE APPROVING: read every answer and open every source_url to confirm
-- it still resolves and still supports the text. These URLs were written
-- from reference knowledge and have not been fetched.

insert into public.guided_topics (slug, title, sort_order) values
  ('moving',     'Moving Every Day',      10),
  ('sleep',      'Sleep and Rest',        20),
  ('food',       'Food and Water',        30),
  ('connection', 'Staying Connected',     40),
  ('mind',       'Keeping the Mind Busy', 50)
on conflict (slug) do nothing;

insert into public.guided_answers
  (topic_id, question, answer, source_name, source_url, sort_order)
select t.id, v.question, v.answer, v.source_name, v.source_url, v.sort_order
from (values
  ('moving',
   'How much walking is good for most older adults?',
   'Most general guidance points to about 150 minutes of moderate movement a week. That is roughly 20 to 25 minutes a day, and a comfortable walk counts. It does not have to happen all at once - three 10-minute walks add up the same as one 30-minute walk. Start with what feels easy and build slowly over weeks, not days.',
   'CDC - Physical Activity for Older Adults',
   'https://www.cdc.gov/physical-activity-basics/guidelines/older-adults.html', 10),
  ('moving',
   'What if walking is hard on the knees or hips?',
   'Movement does not have to mean walking. Seated exercises, water walking, and gentle stretching all count, and many people find water easiest on sore joints. Chair-based routines can be done while watching television. What matters most is moving regularly rather than choosing any particular activity.',
   'National Institute on Aging - Exercise and Physical Activity',
   'https://www.nia.nih.gov/health/exercise-and-physical-activity', 20),
  ('moving',
   'Why does balance practice come up so often?',
   'Balance tends to fade quietly with age, and steadiness is what keeps someone independent at home. Simple practice - standing on one foot near a counter, or walking heel to toe along a hallway - is commonly suggested a couple of times a week. Always keep a solid surface within reach when practising.',
   'National Institute on Aging - Exercise and Physical Activity',
   'https://www.nia.nih.gov/health/exercise-and-physical-activity', 30),

  ('sleep',
   'How much sleep do older adults usually need?',
   'Adults of every age generally need about seven to nine hours. Sleep often becomes lighter and more broken with age, which can feel like needing less, but the underlying need does not really shrink. Waking once or twice is common; waking exhausted most mornings is worth mentioning to the care team.',
   'National Institute on Aging - A Good Night Sleep',
   'https://www.nia.nih.gov/health/sleep/good-nights-sleep', 10),
  ('sleep',
   'What helps with falling asleep more easily?',
   'The habits most often suggested are a consistent bedtime and wake time, including weekends; a cool, dark, quiet room; and keeping screens and bright light out of the last hour before bed. Caffeine late in the day lingers longer as we age. Daylight in the morning helps set the body clock for that night.',
   'National Institute on Aging - A Good Night Sleep',
   'https://www.nia.nih.gov/health/sleep/good-nights-sleep', 20),
  ('sleep',
   'Are daytime naps a problem?',
   'A short early-afternoon nap, roughly 20 to 30 minutes, suits many people and does not usually disturb the night. Long or late naps are the ones that tend to make falling asleep harder. If sleepiness keeps winning during the day despite a full night, that is worth raising with the care team.',
   'National Institute on Aging - A Good Night Sleep',
   'https://www.nia.nih.gov/health/sleep/good-nights-sleep', 30),

  ('food',
   'What does a balanced plate look like?',
   'A common way to picture it: half the plate vegetables and fruit, a quarter whole grains, and a quarter protein such as beans, fish, eggs, or lean meat. Appetite often shrinks with age, so making each plate count matters more than making it large. Familiar foods prepared the way someone likes them beat an ideal plate nobody eats.',
   'MyPlate - Older Adults',
   'https://www.myplate.gov/life-stages/older-adults', 10),
  ('food',
   'How much water should someone drink?',
   'Thirst becomes a weaker signal with age, so many older adults drink less than they need without noticing. A common approach is a glass with every meal and every medication time, rather than counting toward a target. Soups, fruit, and milk all add to the total. Several of the conditions families worry about look worse when someone is simply dry.',
   'National Institute on Aging - Healthy Eating',
   'https://www.nia.nih.gov/health/healthy-eating-nutrition-and-diet', 20),
  ('food',
   'What makes eating alone easier?',
   'Eating alone is one of the most common reasons meals get skipped. Things that help: cooking a batch and freezing single portions, keeping easy foods that need no preparation on hand, and sharing a meal with someone - in person or over a video call - a few times a week. Many communities run senior meal programs worth asking about.',
   'National Institute on Aging - Healthy Eating',
   'https://www.nia.nih.gov/health/healthy-eating-nutrition-and-diet', 30),

  ('connection',
   'Why do people talk about loneliness as a health issue?',
   'Long stretches of isolation have been linked in research to worse health over time, not only to lower mood. The encouraging part is that it responds to ordinary things: a standing phone call, a regular group, a neighbour who checks in. Connection is treated as part of health, not separate from it.',
   'National Institute on Aging - Loneliness and Social Isolation',
   'https://www.nia.nih.gov/health/loneliness-and-social-isolation-tips-staying-connected', 10),
  ('connection',
   'What are easy ways to stay in touch?',
   'A regular rhythm beats intensity - a short call at the same time each week is easier to keep than a long one whenever someone remembers. Shared activity gives a call its shape: a crossword done together, a programme watched at the same time, photographs talked through. Faith groups, libraries, and senior centres all tend to run standing gatherings.',
   'National Institute on Aging - Loneliness and Social Isolation',
   'https://www.nia.nih.gov/health/loneliness-and-social-isolation-tips-staying-connected', 20),
  ('connection',
   'How can family help from far away?',
   'Distance changes the method, not the possibility. Predictable contact at a set time, a shared photo stream, sending a meal, and arranging a local person to visit all travel well. Asking what would actually help tends to work better than guessing, and lets the person keep choosing for themselves.',
   'National Institute on Aging - Loneliness and Social Isolation',
   'https://www.nia.nih.gov/health/loneliness-and-social-isolation-tips-staying-connected', 30),

  ('mind',
   'Does keeping the mind busy actually help?',
   'Staying mentally and socially engaged is consistently grouped with sleep, movement, and diet as part of general brain health. Reading, music, games, learning something new, and conversation are the usual examples. No activity is proven to prevent any disease, which is worth knowing before buying anything that promises it will.',
   'National Institute on Aging - Cognitive Health',
   'https://www.nia.nih.gov/health/brain-health/cognitive-health-and-older-adults', 10),
  ('mind',
   'What kinds of activity are suggested?',
   'Variety and genuine interest matter more than any specific puzzle. Things commonly mentioned: learning an instrument or a language, crafts and woodworking, card and board games with other people, volunteering, and writing down family history. Activities that are social and mental at once tend to be recommended most.',
   'National Institute on Aging - Cognitive Health',
   'https://www.nia.nih.gov/health/brain-health/cognitive-health-and-older-adults', 20),
  ('mind',
   'How do the daily habits fit together?',
   'Sleep, movement, food, connection, and mental activity are usually described as working together rather than separately - better sleep makes movement easier, movement improves sleep, and company supports both. That is why small steady habits across several areas are generally suggested over one big effort in a single one.',
   'National Institute on Aging - Cognitive Health',
   'https://www.nia.nih.gov/health/brain-health/cognitive-health-and-older-adults', 30)
) as v(slug, question, answer, source_name, source_url, sort_order)
join public.guided_topics t on t.slug = v.slug
where not exists (
  select 1 from public.guided_answers a
   where a.topic_id = t.id and a.question = v.question
);

notify pgrst, 'reload schema';
