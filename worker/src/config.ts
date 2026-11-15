// Централизованная конфигурация тарифов и лимитов. Цены меняются только здесь.
// Цены указаны в Telegram Stars (XTR).
export interface Plan { title: string; days: number; stars: number }

export const PLANS: Record<string, Plan> = {
  pro_1m:  { title: '1 месяц',    days: 30,  stars: 149 },
  pro_3m:  { title: '3 месяца',   days: 90,  stars: 349 },
  pro_6m:  { title: '6 месяцев',  days: 180, stars: 599 },
  pro_12m: { title: '12 месяцев', days: 365, stars: 999 },
};

export const FREE_LIMITS = {
  activeHabits: 7,
  analyticsDays: 7,
  freeChallengeCooldownDays: 7,
};
export const PRO_MAX_HISTORY_DAYS = 730;
export const CHALLENGE_MAX_MEMBERS = 50;
export const RATE_LIMIT_PER_MIN = 180;

export const FREE_THEMES = ['default-dark', 'default-light'];
export const ALL_THEMES = ['default-dark', 'default-light', 'midnight', 'violet', 'ocean', 'emerald', 'sunset', 'rose', 'graphite'];
