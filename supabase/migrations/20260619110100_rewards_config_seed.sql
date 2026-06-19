-- One-time seed mirroring data/rewards.ts. Streak milestones reproduce the SQL
-- constants previously hardcoded in apply_order_rewards: day 3 (+50) and day 7
-- (+100) repeating weekly, day 30 (+1000) repeating monthly.
do $$
begin
  insert into public.loyalty_settings (id, beans_per_ringgit, referral_beans, referral_voucher_label)
  values (true, 10, 200, 'RM5 Voucher')
  on conflict (id) do nothing;

  if not exists (select 1 from public.reward_tiers) then
    insert into public.reward_tiers (slug, name, threshold, perk, sort_order) values
      ('fresh', 'Fresh', 0, 'Earn 10 Beans for every RM1 spent.', 0),
      ('bold', 'Bold', 1000, 'A free birthday drink and member-only offers.', 1),
      ('naise-club', 'Naise Club', 3000, 'Free upsizes and early access to new drinks.', 2);
  end if;

  if not exists (select 1 from public.streak_milestones) then
    insert into public.streak_milestones
      (label, display_label, beans, trigger_day, repeat_every_days, sort_order) values
      ('3-Day Streak Bonus', '50 Beans', 50, 3, 7, 0),
      ('7-Day Streak Bonus', '100 Beans', 100, 7, 7, 1),
      ('30-Day Streak Bonus', 'Free Drink', 1000, 30, 30, 2);
  end if;

  if not exists (select 1 from public.reward_catalog) then
    insert into public.reward_catalog (slug, name, cost, product_id, sort_order)
    select v.slug, v.name, v.cost, p.id, v.sort_order
    from (values
      ('free-americano', 'Free Americano', 1000, 'americano', 0),
      ('free-latte', 'Free Latte', 1300, 'naise-signature-latte', 1),
      ('free-matcha', 'Free Matcha', 1500, 'matcha-latte', 2),
      ('free-spanish-latte', 'Free Spanish Latte', 1400, 'spanish-latte', 3)
    ) as v(slug, name, cost, product_slug, sort_order)
    join public.products p on p.slug = v.product_slug;
  end if;
end $$;
