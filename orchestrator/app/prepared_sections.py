"""Generated section + playbook content for the prepared specialists.

Authored and adversarially fact-checked per specialist (see the arrival-pack
design note in prepared.py). Every claim here is either verifiable, or phrased
as a check the customer performs — never an assertion the product cannot
stand behind. Values interpolate from the move spec; anything unknown renders
as a visible <placeholder>.
"""
from __future__ import annotations

from .prepared import register

# agent_id -> (title, body) used when the specialist is BLOCKED on a field.
PLAYBOOKS: dict[str, tuple[str, str]] = {}

register(
    'housing_search',
    'Where to live near work, and who you already know there',
    """Target: {destination_address}. Where you sleep from {move_date} and where you sign a year are two different decisions — make them in that order. Relocate does not tour, apply, sign, or send money; every step below is yours. Steps 2, 5, 6 and 7 point at US-only resources — if {destination_address} is outside the US, ask a local contact or the local consumer-protection agency what the equivalent is before you rely on them.

1. Pin the commute before the neighborhood. Route {work_address} from each candidate address wherever your maps app offers a depart-at/arrive-by time — the control differs by app, platform and travel mode, so use whichever one your app actually exposes — set to your real start time on a weekday, and check the trip home too. Off-peak estimates are fiction. Write down your door-to-door ceiling in minutes; anything over it is off the list.

2. Cut to three neighborhoods inside that ceiling and walk each at the hour you would actually be getting home. Check what listing photos hide: the police department's incident map if the city publishes one, the transit agency's published service frequency on the line you would use, and — for a US address — the FEMA regulatory flood zone for the exact address at msc.fema.gov. That zone is a floor, not a full risk picture: FIRM panels are often years out of date and claims happen outside mapped high-risk zones. Ask the landlord directly whether the unit has ever taken water, and ask for the answer in writing.

3. Find who you already know there before you shortlist further — it is the highest-value hour of this whole search. Filter LinkedIn People to 1st-degree connections in that city. On Facebook the old "friends who live in X" search no longer works, so scroll your friends list and check profiles for a current city. Ask once in an alumni or former-employer group. One message does it: "Moving there around {move_date} — which neighborhood are you in, and how long is your commute?" Locals know which blocks flood, which streets are loud at 2am, which management companies people warn each other about, and who has a sublet coming free.

4. Land before you lease. Book a furnished landing stay near work starting {move_date} — plan on a month or two — and live in the area before you sign for a year. Confirm each property's minimum stay and its monthly rate before you compare: extended-stay hotels, corporate housing, and furnished month-to-month sublets (Airbnb monthly stays, Furnished Finder, the furnished filter on the major rental portals) each set their own minimums and monthly thresholds. Price all three over the same window, not over whatever window each one quotes. Then ask every building you shortlist which lease terms it actually offers — 6, 9, 12, 13 and 18 months are all common and can price very differently.

5. Before any money moves, ask who owns the unit and get the answer in writing. Where the local recorder — county, parish, borough, or independent city, depending on the state — publishes property records online, look up the owner of record; many publish, some charge, some require an in-person request, and some states let owners redact their names, so "not found" is no information rather than a red flag. A name that does not match your lease is not proof of a scam either: an LLC, a family trust, one of several co-owners, a master tenant on a lawful sublease, or a buyer whose deed has not been recorded yet are all ordinary. Treat a mismatch as a question — "what is your relationship to the owner of record?" — and ask for something that documents the answer: a management agreement, the signed head lease, or the company's own published listing of the property. Call any management company on the number published on its own site, never the number in the ad.

6. Treat a deposit sent by wire, Zelle, Venmo, crypto, or gift card as unrecoverable. Some banks and some card-funded payments have dispute or reimbursement paths, but none you should count on, and those are the rails scammers ask for. Your real protection is not the payment method: it is that you or someone you trust has stood inside the exact unit, and that you have a signed lease naming the unit and the amount before any money leaves. A video walkthrough counts only if they take the call live from inside and show what you ask for on the spot.

7. Deposit caps, return deadlines, itemization, and interest are set by state and often city law, not by your lease. Read your destination state's tenant-rights page before you sign — search "<state> attorney general tenant rights" or your city's rent board — so you know what the lease can and cannot change. What a specific clause means for you is a question for that agency or a tenant attorney, not for us.

8. Walk away on any one of these: rent well below comparable units on the same street, an owner "out of the country" who will mail the keys, pressure to hold it today, or any refusal to let you see it first. Reverse-image-search the listing photos and search the street address in quotes across listing sites. The same photos under a second address is a strong sign the listing may be stolen — it also happens honestly through syndication, identical floorplans from one management company, re-listed units, and stock staging photos — so confirm it before you pay anything.

9. Get the move-in total in writing before you commit: first month, deposit, application and admin fees, pet and parking fees, and which utilities are not included. Ask which of those is refundable and under what conditions. Verbal numbers do not survive the walkthrough.""",
)
PLAYBOOKS['housing_search'] = (
    'Housing search checklist',
    """Housing is the one item you can start today with no account numbers and no credentials. Order matters: commute, then people, then a landing stay, then a lease. Relocate never tours, applies, signs, or sends money — these steps are yours. Steps 5, 6 and 7 name US-only resources; for a destination outside the US, ask a local contact what the equivalent is.

1. Write down {work_address} and the longest door-to-door commute you will accept, each way, in minutes.

2. Route three candidate neighborhoods to it wherever your maps app offers a depart-at/arrive-by time — the control differs by app, platform and travel mode — set to your real start time on a weekday. Drop anything over your ceiling. Off-peak estimates are fiction.

3. Find your people in <the destination city> the same day: filter LinkedIn People to 1st-degree connections there, scroll your Facebook friends list and check profiles for a current city (the old "friends who live in X" search no longer works), and ask once in an alumni or former-employer group. One message — "moving <your move date>, which neighborhood are you in and how long is your commute?" — beats a week of scrolling listings.

4. Book a furnished landing stay near work for <your move date>, before signing anything for a year. Confirm each property's minimum stay and its monthly rate first, then price extended-stay hotels, corporate housing, and furnished month-to-month sublets (Airbnb monthly stays, Furnished Finder, the furnished filter on the major rental portals) over that same window. Ask each building which lease terms it offers — 6, 9, 12, 13 and 18 months are all common.

5. Before any deposit, ask who owns the unit and get the answer in writing. If your county — or parish, borough, or independent city — publishes property records online, look up the owner of record: search "<county or city name> property search". Many publish; some charge, some require an in-person request, and some states let owners redact their names, so "not found" tells you nothing either way. A name that does not match the lease is a question, not a verdict — an LLC, a trust, one co-owner, a lawful sublease, or an unrecorded deed are all ordinary. Ask what their relationship to the owner of record is and for a document that shows it. Call any management company on the number published on its own site, never the number in the ad.

6. Treat a deposit sent by wire, Zelle, Venmo, crypto, or gift card as unrecoverable. The protection that works is standing inside the exact unit — you, or someone you trust, live on the call — and a signed lease naming the unit and the amount before any money leaves.

7. Deposit caps, return deadlines and itemization are set by state and often city law, not by your lease. Read your destination state's tenant-rights page (search "<state> attorney general tenant rights" or your city's rent board) before you sign; take any specific clause to that agency or a tenant attorney.

8. Walk on any of these: rent well below comparable units nearby, an owner "out of the country" who will mail the keys, pressure to pay today, or no walkthrough. Reverse-image-search the photos and search the street address in quotes — the same photos under another address is a strong sign the listing may be stolen, though syndication and repeated floorplans produce it honestly too. Confirm before you pay anything.

9. Get the move-in total in writing before you commit — first month, deposit, application and admin fees, pet and parking fees, utilities not included — and ask which parts are refundable and under what conditions.""",
)

register(
    'arrival_transport',
    'Arrival-day ground transport plan',
    """Relocate prepares this plan; you book it. No ride is reserved, held, or paid on your behalf.

1. Find the ground-transportation page for {destination_airport} on the airport's own site, not an aggregator, and note where app pickup, the taxi rank, and pre-booked cars each stage. At many airports app pickup is a different level or a garage, not the arrivals curb, and that walk with a luggage cart is the part people plan around badly. If the airport publishes no ground-transportation page, call the airport information line and ask those three questions.
2. Size the vehicle by bags, not headcount. Household on file: {household_size}. Count your checked bags, then compare that against the luggage capacity the app lists for each class before you book — four or more checked bags, or three-plus travelers each with bags, generally will not fit a sedan. Larger classes are not offered in every market, and a six-seat XL with the third row up can hold less luggage than a sedan, so check which larger classes your arrival market actually offers rather than assuming one is there. Two cars is a legitimate answer.
3. Pre-book instead of hailing if any of these is true: a late-night arrival, a pet, a child car seat, or a key handoff at {destination_address} inside a fixed window. Give the operator your flight number, then ask whether they track flight status, how much free wait time is included after wheels-down, and what waiting costs after that — those vary by operator and are often paid add-ons. Get the confirmation number, the dispatch phone, and the cancellation window in writing. A standard on-demand hail holds nothing for a late flight; reserved or scheduled ride options exist in some markets — check whether yours has one.
4. Pets: platform policy and local rules on pets, service animals, and assistance animals differ by market, so check the rideshare app's pet and service-animal policy for your destination before you count on it. The reliable path is a local car service: state species and carrier size when booking, and reconfirm by phone the day before.
5. Car seats: rideshare drivers do not supply them, and the in-app car-seat option does not exist in every market — check whether yours offers it. Plan to bring your own. Confirm the checked car-seat and stroller policy with your airline before you fly; do not assume it is free.
6. Keep a no-app fallback, but verify it exists. On the step 1 page, confirm whether {destination_airport} has a taxi rank and what payment it accepts — some airports have none and run on phone dispatch or ride-hail only, and some ranks are cash-only or card-only. If there is a rank, ask whether the fare is metered, zoned, or flat before the bags go in the trunk.
7. Save {destination_address} offline — screenshot plus a written copy — with the unit number, the entrance to use, and any gate code. GPS drops a driver at the front of the building, not at your door. If you are switching carrier or phone plan around {move_date}, assume you have no data at the curb.
8. Check the payment method in your ride app before {move_date}. A stored card can be declined when its billing address no longer matches, so re-enter or re-add the card with your current billing address and load a second payment method now. If a card has already declined, call {bank_name} and ask what they need to clear it.
9. Arriving by rental car instead: confirm on the rental company's own site which pickup you actually booked at {destination_airport} — on-airport, shuttle-served, or an off-airport branch you have to reach yourself by taxi or ride-hail. All three are common. Then confirm the return location you want near {destination_address} is open on your date.""",
)
PLAYBOOKS['arrival_transport'] = (
    'Arrival-day transport checklist',
    """Airport to door, in the order that decides the day. You book everything below; Relocate does not reserve or pay for rides.

1. Read the ground-transportation page for {destination_airport} on the airport's own site: where app pickup, the taxi rank, and pre-booked cars stage. App pickup is often a different level or garage from the arrivals curb. If there is no such page, call the airport information line and ask.
2. Size the ride by bags, not headcount. Household on file: {household_size}. Count your checked bags and compare against the luggage capacity the app lists per class — four or more checked bags, or three-plus travelers each with bags, generally will not fit a sedan. Larger classes are not in every market, and an XL with the third row up can hold less than a sedan; check what your arrival market offers, or take two cars.
3. Pre-book rather than hail if any apply: late-night arrival, a pet, a child car seat, or a timed key handoff at {destination_address}. Give the operator your flight number, then ask whether they track flight status, how much free wait time is included after landing, and what waiting costs after that. Keep the confirmation number, dispatch phone, and cancellation window. An on-demand hail holds nothing for a late flight; reserved or scheduled options exist in some markets — check yours.
4. Pets: platform policy and local rules on pets and service animals vary by market — check the app's pet and service-animal policy for your destination. Or call a car service and state species and carrier size at booking.
5. Car seats: drivers do not supply them, and the in-app car-seat option does not exist in every market — check yours. Bring your own; confirm the checked car-seat and stroller policy with your airline before you fly.
6. Fallback: on the step 1 page, confirm whether {destination_airport} has a taxi rank and what payment it accepts — not every airport has one, and some are cash-only or card-only. If it does, ask whether the fare is metered, zoned, or flat before loading.
7. Save {destination_address} offline with unit number, entrance, and gate code — GPS stops at the building, not the door. If you are switching carrier or phone plan around {move_date}, assume no data at the curb.
8. Re-enter or re-add the card in your ride app with your current billing address, and load a second payment method. If a card has already declined, call {bank_name}.
9. Rental car instead: confirm on the rental company's own site whether pickup at {destination_airport} is on-airport, shuttle-served, or an off-airport branch you must reach yourself — all three are common — and that your return location near {destination_address} is open the day you land.""",
)

register(
    'mobile_carrier',
    'Keeping your number when you change carriers',
    """Never cancel the old line first. A port pulls your number off an ACTIVE account — cancel first and the number goes back to the carrier, and getting it back is not something to count on. When the port completes, the OLD carrier ends service on that line. That is not the same as closing the account: on a multi-line, bundled, or device-installment account, the account can stay open and keep billing (remaining lines, insurance and add-ons, autopay, home internet, a final bill). Ask the old carrier what is still open and still billing after the port, and get the answer in writing. Steps 1-9 describe US carriers; a non-US carrier runs its own process — ask it what it needs.

1. Decide: port the number, or take a new one. A new number means re-verifying every account that uses your number — banks, 2FA, doctors, schools, work SSO — a long tail of cleanup. Porting skips it.
2. Check coverage at {destination_address} on each carrier's own coverage map, by street address, not by city. Those maps are modeled predictions the carriers themselves disclaim, and indoor coverage at an address often differs. Back the map with a real check: ask neighbors or the building what works there, or ask the new carrier whether it has a trial period or return window, and on what terms, then use it to test service at the address before you commit the port.
3. From the OLD carrier, while the line is still active, get the account number used for porting (often not your phone number) and a number-transfer PIN. These come from the carrier's app, its website, a texted keyword, or a call — the method varies by carrier, and prepaid brands differ from postpaid, so ask which one applies to your account. Transfer PINs often expire — ask how long yours is valid and pull it close to port day.
4. On that same contact, ask whether a port-out or number-transfer lock is set on the account, and turn it off before you request the port. Carriers sell these under different names and some are on by default; an active lock blocks the port even with the correct PIN and a perfectly matching name.
5. Give the NEW carrier: that account number, the transfer PIN, the billing ZIP, and the account holder name EXACTLY as the old carrier has it. A name or address mismatch is a common reason ports get rejected.
6. Before porting, ask the old carrier what port-out does to a device-installment balance, promotional bill credits, and any contract terms. Ask for the payoff figure on that call and note the rep's name and the date.
7. Move SMS-based 2FA (bank, email, brokerage) to an authenticator app before port day — texts can go missing during the cutover. Where an institution offers SMS only, ask whether it issues backup or recovery codes — if it does, download and store them; if it does not, expect gaps around the cutover and ask what its account-recovery path is, and expect possible SMS gaps around the cutover.
8. If the new carrier offers a trial eSIM or a temporary number, test call, text, and data on it before you submit the port request. With many carriers the port itself is the activation, so there is no new line to test beforehand — ask the new carrier which applies.
9. Wi-Fi calling: 911 calls placed over Wi-Fi calling are routed using the address you register with the carrier. Ask the carrier how quickly a saved 911 address takes effect and whether it needs verifying, so keep {origin_address} on file until you are actually living at {destination_address}, then change it. A 911 call over the cellular network is located by the network and handset, not by the address on file.

Moving abroad: ask the old carrier what its handset-unlock criteria are and whether this device qualifies yet — eligibility varies by carrier (installment balance, account standing, minimum active service, prepaid vs postpaid), and a device that is not yet eligible cannot be unlocked on request. A locked phone will not accept a local SIM or eSIM. Buy the local SIM or eSIM after arrival. To keep the US number alive you can park it on a number-parking or low-cost prepaid service — on that provider's own site, check the current port-in fee AND whether the service will accept your specific number, since acceptance varies by number. If the parking service is VoIP, the number becomes a VoIP number, and some banks and brokerages reject VoIP numbers for SMS 2FA — ask the institutions that matter to you before you park it there. Parking is still a port, so steps 3, 4 and 5 apply.

Relocate does not open, port, or cancel lines. You place the port request with the new carrier; it needs your identity verification and your PIN.""",
)
PLAYBOOKS['mobile_carrier'] = (
    'Mobile number port checklist',
    """Never cancel the old line first — a port pulls the number off an ACTIVE account. Cancel first and the number goes back to the carrier; do not count on getting it back. Steps below describe US carriers.

1. From the OLD carrier, while the line is still active, get the port-out account number (often not your phone number) and a number-transfer PIN. Ask which channel applies to your account — app, website, texted keyword, or a call — and how long the PIN stays valid.
2. On the same contact, ask whether a port-out or number-transfer lock is set on the account and turn it off before you request the port. An active lock blocks the port even with the correct PIN and a matching name.
3. Give the NEW carrier that account number, the PIN, the billing ZIP, and the account holder name exactly as the old carrier has it. Mismatches are a common reason ports get rejected.
4. Ask the old carrier what porting out does to a device-installment balance, promo credits, and contract terms. Get the payoff figure on the call.
5. Move SMS-based 2FA to an authenticator app before port day — texts can go missing during the cutover. Where an institution offers SMS only, ask whether it issues backup or recovery codes and store any it provides; if it has none, ask what its account-recovery path is and expect possible SMS gaps around the cutover.
6. Check coverage at <your new address> on each carrier's own coverage map, by street address. Those maps are modeled predictions the carriers disclaim, so add a real check: ask neighbors or the building what works there, or ask whether the new carrier has a trial period or return window, and on what terms, before you commit the port.
7. If the new carrier offers a trial eSIM or a temporary number, test call, text, and data on it before you submit the port request. With many carriers the port itself is the activation, so there is no new line to test first — ask which applies.
8. When the port completes, the OLD carrier ends service on that line. The account can stay open and keep billing (other lines, add-ons, installments, home internet, a final bill) — ask the old carrier what is still open and still billing, in writing.
9. Wi-Fi calling: 911 calls placed over Wi-Fi calling are routed using the address you register. Ask how quickly a saved 911 address takes effect, so keep <your current address> on file until you are actually living at <your new address>, then change it.
10. Moving abroad: ask the old carrier what its handset-unlock criteria are and whether this device qualifies yet — eligibility varies and an ineligible device cannot be unlocked on request. Buy a local SIM or eSIM on arrival. To keep the US number, park it on a number-parking or low-cost prepaid service — check on that provider's own site both the port-in fee and whether it will accept your specific number; if the service is VoIP, some banks and brokerages reject VoIP numbers for SMS 2FA. Parking is still a port, so steps 1-3 apply.

You place the port yourself: the new carrier verifies your identity and your PIN. Relocate does not open, port, or cancel lines.""",
)

register(
    'gov_address_update',
    'Government records that still have your old address',
    """USPS forwarding moves your mail. It changes no government record. These are US federal, state, and local records, and Relocate files none of them for you — each one needs your own identity check or signature. Every deadline is set by the agency, so check it on the site named.

1. VOTER REGISTRATION — moving to a new state does not transfer it; an in-state move still needs an address update, and in many states a driver's-license address change doubles as that update. Check which applies to you, and register for {destination_address}, through vote.gov, which routes to your state's official election office. Cutoffs are state-set (some states register you on election day, others close weeks out) — read yours there before you plan around it, and check whether the old state expects you to cancel.
2. SELECTIVE SERVICE — registrants must keep the address current at sss.gov. Who has to register is narrower and more specific than most people assume, and it is not limited to US citizens — confirm whether it applies to you on that site rather than self-sorting.
3. IRS — file Form 8822, Change of Address, from irs.gov (never a third-party form site). Your next return filed with {destination_address} updates the record too, but 8822 is what redirects notices and paper checks before then.
4. STATE TAX — neither state updates your address because the other did; you file with each separately. On each revenue department's site, look for an address-change form and for whether a part-year return is due for the year you moved — if that state levies an income tax at all; several do not.
5. SOCIAL SECURITY — chiefly for people receiving benefits or Medicare, but a pending claim or SSI can carry its own reporting duty on its own clock. Confirm at ssa.gov whether it applies to you. If it does, change the address in your my Social Security account; the online change is not open to every record, and ssa.gov will tell you which route applies to yours.
6. PROPERTY EXEMPTIONS — owner-occupied exemptions do not follow you from the old property, and the filing office varies by state: some are handled by a county, city, or township assessor, others by a state agency. If you own at {destination_address}, find the office that takes the filing for that address on the county or state assessment site, and confirm the deadline there. Check the same site for a local income tax, which some cities and counties levy.
7. OLD JURISDICTION — close what is still open at {origin_address}: local tax accounts, property exemptions, prior voter registration.
8. Save every confirmation number, filed date, and receipt page in one place. The receipt is the fastest proof you filed.

If you are not a US citizen, a separate federal address filing (USCIS AR-11) may apply on a much shorter clock — check whether it applies to you, and by when, at uscis.gov. That is a different item on your list, not this one.""",
)
PLAYBOOKS['gov_address_update'] = (
    'Government address-of-record checklist',
    """US records that USPS forwarding does not touch. Relocate files none of them — each needs your identity check or signature. Deadlines are set by each agency; check each on the site named.

1. VOTER REGISTRATION — moving to a new state does not transfer it; an in-state move still needs an address update, and in many states a driver's-license address change doubles as that update. Check which applies to you at vote.gov, which routes to your state's official election office. Cutoffs differ by state (same-day in some, weeks out in others) — read yours there, and check whether the state you left expects you to cancel the old registration yourself.
2. SELECTIVE SERVICE — registrants must keep the address current at sss.gov. Who has to register is narrower and more specific than most people assume, and is not limited to US citizens — confirm whether it applies to you on that site.
3. IRS — file Form 8822, Change of Address, from irs.gov. Your next return filed at the new address updates the record too; 8822 redirects notices and paper checks in the meantime.
4. STATE TAX — neither state updates your address because the other did; you file with each separately. Check each revenue department's site for an address-change form and for whether a part-year return is due for the year you moved, if that state levies an income tax at all.
5. SOCIAL SECURITY — chiefly for people receiving benefits or Medicare, but a pending claim or SSI can carry its own reporting duty. Confirm at ssa.gov whether it applies to you; if it does, update the address in my Social Security, and if the online change is not available for your record, ssa.gov will tell you which route applies.
6. PROPERTY EXEMPTIONS — owner-occupied exemptions do not follow you, and the filing office varies by state: a county, city, or township assessor in some, a state agency in others. If you own, find the office that takes the filing for your new address on the county or state assessment site and confirm the deadline there. Some localities also levy their own income tax — check the same site.
7. Close what is still open at your old address: local tax accounts, property exemptions, prior voter registration.
8. Save every confirmation number and receipt page. That is the fastest proof you filed.

If you are not a US citizen, a separate federal address filing (USCIS AR-11) may apply on a much shorter clock — check whether it applies to you, and by when, at uscis.gov.""",
)

register(
    'visa_support',
    'Brief your immigration counsel',
    """Relocate does not give legal advice and does not file, sign, submit, or pay anything for you. This is preparation, so your first exchange with counsel is one email instead of five.

1. Settle who owns the case before you write: your employer's mobility team, or counsel you retain yourself. If your employer sponsors you, ask mobility who is authorized to contact counsel on your case and whether you may email counsel directly — that varies by employer and by engagement letter.
2. Send one opening email carrying the facts most cases start with: full legal name exactly as printed in your passport, current address {origin_address}, new address {destination_address}, move date {move_date}, reply-to {user_email}, your new physical work location, and whether employer, role, or hours change.
3. Close that email with five questions: which authority governs my case; does this address change require a filing, and by when; does the new work location require anything before {move_date}; does anyone else in the household need action; what do you need from me, and by when.
4. Ask counsel which documents they need, then gather the ones you have — one PDF per person: passport bio page and every stamped page, current visa or residence permit, and every receipt, approval, or decision notice you hold. If your case is with USCIS, ask whether they also need your latest I-94 (retrieve it at i94.cbp.dhs.gov — type that address into your browser yourself rather than following a link) and any EAD or permanent resident card. Ask what each dependent needs rather than assuming.
5. Take no deadline, fee, eligibility rule, filing obligation, or notice-routing statement from anyone but counsel or the official government source for the authority handling your case — including from this page. For a USCIS case that source is uscis.gov. If a date matters, get it in writing.
6. Ask counsel whether an address-of-record filing is required for you and by when, and whether any pending case needs the address updated on the case itself rather than only through a general change-of-address process.
7. If an attorney is on record for you, ask counsel who receives your original notices and secure documents — card, permit, EAD — after {move_date}: you, them, or both. Keep mail collection running at {origin_address} until counsel says to stop.
8. Ask counsel before booking any international travel near {move_date}. Get every answer in writing — a phone call, hallway conversation, or chat message is not a record.

You send these. Relocate prepares them and never files, submits, or pays on your behalf.""",
)
PLAYBOOKS['visa_support'] = (
    'Immigration counsel briefing checklist',
    """Relocate does not give legal advice and never files, signs, submits, or pays for you. Run this while the missing move details get filled in.

1. Decide who owns the case: your employer's mobility team, or counsel you retain yourself. If your employer sponsors you, ask mobility who is authorized to contact counsel on your case and whether you may email counsel directly — that varies by employer and by engagement letter.
2. Draft one opening email holding the facts most cases start with: full legal name exactly as printed in your passport, your current address, your new address, your move date, your new physical work location, and whether employer, role, or hours change.
3. End it with five questions: which authority governs my case; does this address change require a filing, and by when; does the new work location require anything before the move; does anyone else in the household need action; what do you need from me, and by when.
4. Ask counsel which documents they need, then gather the ones you have — one PDF per person: passport bio page and every stamped page, current visa or residence permit, and every receipt, approval, or decision notice you hold. If your case is with USCIS, ask whether they also need your latest I-94 (retrieve it at i94.cbp.dhs.gov — type that address into your browser yourself rather than following a link) and any EAD or permanent resident card. Ask what each dependent needs rather than assuming.
5. Take no deadline, fee, eligibility rule, filing obligation, or notice-routing statement from anyone but counsel or the official government source for the authority handling your case — including from this page. For a USCIS case that source is uscis.gov. If a date matters, get it in writing.
6. Ask counsel whether an address-of-record filing is required for you and by when, and whether any pending case needs the address updated on the case itself rather than only through a general change-of-address process.
7. If an attorney is on record for you, ask counsel who receives your original notices and secure documents — card, permit, EAD — after the move: you, them, or both. Keep mail collection at your current address running until counsel says to stop.
8. Ask counsel before booking any international travel near the move date. Get every answer in writing — a phone call, hallway conversation, or chat message is not a record.""",
)

register(
    'landlord_notice',
    'Give your landlord notice',
    """Relocate does not send this. Review it, sign it, send it yourself — ending a tenancy is your signature. This is move preparation, not legal advice: for a mid-term lease break, a disputed deduction, or a co-tenant disagreement, take it to a local tenant-rights service or a housing attorney before you commit to anything.

Before you send anything: read your lease's termination clause and establish which tenancy you have. A month-to-month or other periodic tenancy is normally ended by notice. A fixed-term lease still inside its term usually is not — the same letter can read as a dated, signed statement that you intend to break the lease. If you are inside a fixed term, ask about the lease-break terms first and send nothing until you have them.

--- notice to vacate ---
To: <landlord or property manager, at the name and address your lease names for notices>
Date: <the date you send this>

Written notice that I am terminating my tenancy at {origin_address} and will vacate on or before {move_date}.

Forwarding address for the security-deposit accounting and any refund: {destination_address}.

Please confirm in writing: receipt of this notice and the date my notice period ends under the lease; a date and time for a move-out inspection I can attend; where and how keys are to be returned.

Signature: ______________________  Date: ____________
Printed name: <your full legal name>
(repeat these two lines, once for each person named on the lease)
--- end ---

1. The notice period is set by your lease AND by your state or local law — check both. A statutory minimum can supplement or override a lease term, and can apply where the lease is silent. In the US, confirm yours on your state attorney general or consumer-protection housing page and on your city or county housing or rent-board page. Outside the US, check your national or regional tenancy authority.
2. Most leases count the period from the day the landlord receives the notice — confirm which day yours counts from. Some count from mailing, some add days for mailing, some run the period from the next rent due date. Check whether the notice also has to land before a rent period starts.
3. Send it by the method the lease requires — in the US commonly certified mail, the email address named for notices, or hand delivery — and check whether your state prescribes or limits how notice must be delivered, since emailed notice is not valid service everywhere. Keep the proof: the certified receipt, or the recorded or registered delivery your postal service offers, or the sent message. The notices address is often not the rent-payment address.
4. If the notice period runs past {move_date}, ask in the same message what rent you still owe and whether the lease has an early-release or reletting clause. Get the answer in writing, and have someone qualified read it before you accept a figure.
5. If anyone else is named on the lease, ask your landlord in writing what they require from each leaseholder, and have every leaseholder sign — notice from one co-tenant may not end the tenancy for all.
6. If your landlord agrees to a walkthrough, or your state gives you a right to one, be there. If there is no inspection, document anyway: once the unit is empty, photograph or video every room, the appliances, and the meter readings with timestamps. That set is your evidence if a deduction appears later.
7. Deposit-return deadlines and allowed deductions are set by state and local law, which can override what your lease says. Confirm yours on your state attorney general or consumer-protection housing page and on your city or county housing or rent-board page — city, county, and rent-board rules are not on the state page. Outside the US, check your national or regional tenancy authority.
8. Ask for an itemized statement with receipts. Keep the signed notice, the delivery proof, and the photos until the deposit clears. If a deduction looks wrong, that is a question for a local tenant-rights service or legal-aid office, not one to settle on the phone.
""",
)
PLAYBOOKS['landlord_notice'] = (
    'Notice to vacate (ready to sign)',
    """Relocate does not send this. Review it, sign it, send it yourself. This is move preparation, not legal advice — for a mid-term lease break, a disputed deduction, or a co-tenant disagreement, ask a local tenant-rights service or a housing attorney.

Before you send anything: read your lease's termination clause and establish whether your tenancy is periodic (month-to-month) or a fixed term still running. A periodic tenancy is normally ended by notice; inside a fixed term this letter may not end the tenancy or your rent liability, and can read as a dated, signed statement that you intend to break the lease. Ask about the lease-break terms first.

--- notice to vacate ---
To: <landlord or property manager, at the name and address your lease names for notices>
Date: <the date you send this>

Written notice that I am terminating my tenancy at <the address you are leaving> and will vacate on or before <your move-out date>.

Forwarding address for the security-deposit accounting and any refund: <your new address>.

Please confirm in writing: receipt of this notice and the date my notice period ends under the lease; a date and time for a move-out inspection I can attend; where and how keys are to be returned.

Signature: ______________________  Date: ____________
Printed name: <your full legal name>
(repeat these two lines, once for each person named on the lease)
--- end ---

1. The notice period is set by your lease AND by your state or local law — check both. In the US, confirm on your state attorney general or consumer-protection housing page and on your city or county housing or rent-board page; outside the US, on your national or regional tenancy authority.
2. Most leases count the period from the day the landlord receives the notice — confirm which day yours counts from, and whether the notice must land before a rent period starts.
3. Send it by the method the lease requires, and check whether your state prescribes or limits how notice must be delivered — emailed notice is not valid service everywhere. Keep the proof: in the US the certified receipt, elsewhere the recorded or registered delivery your postal service offers. Ask your landlord in writing what they require from each leaseholder and have every leaseholder sign; notice from one co-tenant may not end the tenancy for all.
4. If your landlord agrees to a walkthrough, or your state gives you a right to one, be there. Either way, once the unit is empty, photograph or video every room, the appliances, and the meter readings with timestamps.
5. Deposit-return deadlines and allowed deductions are set by state and local law, which can override what your lease says — confirm yours on the state page and on your city or county housing or rent-board page, ask for an itemized statement with receipts, and keep everything until the deposit clears. If a deduction looks wrong, take it to a local tenant-rights service or legal-aid office.
""",
)

register(
    'intl_banking',
    'Banking in the new country',
    """Two accounts in two countries. The risk to avoid is a window where the new account is not open yet and the old one has started restricting you — so start the new one before you close the old one.

1. Ask the specific destination branch for their document list before you go in. Expect passport, visa or residence permit, and a local proof of address once you have one in your own name. Banks add their own requirements on top of the country's legal minimum, so the branch's list is the one that counts.
2. A common blocker for new arrivals is having no local address yet. In some destinations the binding blocker is a local tax or registration number, or a requirement to appear in person. Ask the branch directly: what blocks a new arrival at your bank, and do you open a newcomer or non-resident account on passport plus proof of employment?
3. Multi-currency e-money accounts (Wise, Revolut, and similar) are sometimes used to bridge the gap. Before relying on one, confirm three things: that the provider serves your destination country and accepts your residency status and nationality; whether balances are held under deposit insurance or under safeguarding rules, which are not the same protection — ask the provider which applies to you; and that payroll and your landlord will actually accept it for salary and rent.
4. Keep the origin account open past {move_date}. Final utility bills, tax refunds, and card disputes arrive after you leave. Before you close it, check your card issuer's dispute window and your tax authority's refund timing — those set how long you actually need it open.
5. Ask your origin bank, {bank_name}, one question directly: what happens to this account when my registered address is outside the country? Some re-code it, some restrict online access, some close it. Get the answer in writing through a channel the bank confirms is secure — secure message center, in-app upload, or in branch. If they offer none, ask what channel they do accept.
6. Ask your origin bank which second factor it uses and whether it will register a foreign mobile number. If any of your access still depends on an SMS code to your origin number, keep that number live until the new account is running.
7. Update your address at every institution separately — bank, cards, brokerage, pension. Do not assume a change at one reaches the others; confirm each one. Ask each card issuer whether they still accept a travel or relocation notice and how to file one — several no longer take them.
8. Before moving a balance, ask your bank and any transfer provider two things: their limits, and what reporting applies to the amount you are moving. The cost can sit in the fee, in the exchange-rate spread, or both — ask for the total that will actually land, in the destination currency. What is owed or reportable is a question for a licensed tax or financial adviser, not for us; if you are moving out of the US, ask that adviser which US rules follow a foreign account in your name.
9. No bank asks for a password, PIN, full account number, or a passport scan by email. If a message does, do not reply and do not click anything in it — call the number printed on the back of your card or listed on the bank's official site. Send documents only through a channel the bank has confirmed is secure, or in branch.

Relocate does not open, close, or fund accounts, and does not move money. Every step above is yours to execute.""",
)
PLAYBOOKS['intl_banking'] = (
    'Cross-border banking checklist',
    """Opening an account in your destination country, and deciding what to do with the old one.

1. Call the specific destination branch and ask for their document list for a new arrival. Expect passport, visa or residence permit, and a local proof of address once you have one in your own name. Banks add their own requirements on top of the country's legal minimum — the branch's list is the one that counts.
2. Ask the branch what actually blocks a new arrival at their bank: no local address yet, a local tax or registration number, an in-person appearance, or something else. Ask whether they open a newcomer or non-resident account on passport plus proof of employment.
3. If you are considering a multi-currency e-money account to bridge the gap, confirm the provider serves your destination country and accepts your residency status, ask whether balances are held under deposit insurance or under safeguarding rules, and confirm with payroll and your landlord that they accept it for salary and rent.
4. Keep your origin bank account open past the move. Final bills, refunds, and card disputes arrive after you go. Before closing, check your card issuer's dispute window and your tax authority's refund timing.
5. Ask your origin bank in writing what happens to the account once the registered address is foreign — some re-code it, some restrict it, some close it. Use a channel the bank confirms is secure: message center, in-app upload, or in branch. Ask what they accept if they offer none.
6. Ask your origin bank which second factor it uses and whether it will register a foreign mobile number. Keep your origin number live while any access still depends on an SMS code to it.
7. Update the address at each institution separately: bank, cards, brokerage, pension. Do not assume a change at one reaches the others. Ask each card issuer whether they still accept a travel or relocation notice and how to file one.
8. Before moving a balance, ask your bank and the transfer provider about their limits and what reporting applies to the amount. Ask for the total that will actually land — the cost can sit in the fee, in the exchange-rate spread, or both. Take the tax and reporting question to a licensed adviser.
9. Never send a password, PIN, full account number, or passport scan by email. If a message asks for one, do not reply and do not click any link — call the number on the back of your card or on the bank's official site.

Relocate never opens, closes, or funds an account, and never moves money. Every step is yours to execute.""",
)

register(
    'fx_planning',
    'Currency transfer comparison guide',
    """Moving money for the move to {destination_address}. Relocate never moves, holds, or converts money, and never quotes or predicts rates — you open the account and send every transfer yourself. Nothing here is financial advice.

1. Start the receiving account early. Ask the specific bank what it requires — proof of local address, residence permit, tax ID, an in-person appearance — and whether the application can be started before you arrive. Requirements vary by country and by bank. Ask for the expected timeline in writing; it is often the longest lead time on this list.
2. Price every option on ONE number: what LANDS in the destination account. Make each provider put the rate, the fee, and the landed amount on the same written quote.
3. Compare that rate against the mid-market (interbank) rate for the pair, taken from a source that is not the provider's own page. Write the source name and the timestamp next to each quote — mid-market rates differ by source and by minute, and the two numbers only compare if you took them together.
4. Take 2-3 quotes inside the same hour on the same amount: your existing bank, a licensed money-transfer operator, an FX broker. Rates move; quotes taken on different days do not compare.
5. Ask in writing: do correspondent or intermediary banks deduct anything en route, who pays those charges, and what is the value date the money is actually available to the recipient.
6. Send a small transfer first and confirm it landed before you send the balance. A test proves the account number reaches an account; it does not prove the name on that account is yours. Ask each provider whether the beneficiary name is checked on this route, and what its recall process is when money reaches a valid account belonging to someone else. Get both answers in writing before the large transfer.
7. Fraud rule, no exceptions: any payment instruction, or any change to account details you already have, that arrives by email or message gets verified by phone on a number you already hold — from your own statement or the institution's official site, never a number printed in the message. Read the beneficiary name and account number back on that call.
8. Do not let a deposit, first rent, or closing depend on money landing the same day. Settlement time varies by provider, corridor, and rail — get the expected value date in writing for your specific currency pair. Holidays in the sending country, in the receiving country, and in the country whose currency clears the payment can each stop settlement, so ask which calendars apply.
9. Ask each provider what transfer size triggers compliance and source-of-funds checks, and exactly which documents it will want (sale contract, payslips, tax return). Thresholds are set by the provider and the country, not published uniformly. Have the documents in hand before {move_date} — the check is the delay.

Sending from the US, before you fund anything: look the provider up on FinCEN's MSB registrant search, and ask which state money transmitter license covers a customer in your state, then confirm that license on NMLS Consumer Access. A listing confirms a filing or a license, not approval or endorsement — treat it as a floor, not a recommendation. A bank itself is not an MSB registrant, so a bank's absence from that search is not by itself a red flag — but a bank's separately-incorporated money-transmission subsidiary can be required to register. Confirm the exact legal entity you are paying, and ask it in writing under which registration or licence it holds your funds. Sending from anywhere else, the equivalent check is that country's own financial regulator's register.

We quote no rates, fees, or limits — collect every one of them in writing from each provider. We send nothing on your behalf.""",
)
PLAYBOOKS['fx_planning'] = (
    'Currency transfer checklist',
    """Cross-border transfers to <destination address> around <move date>. Relocate never moves, holds, or converts money and does not advise on rates — you run every step. Nothing here is financial advice.

1. Start the receiving account early. Ask that specific bank what it requires — proof of local address, residence permit, tax ID, an in-person appearance — and whether you can start the application before arrival. Requirements vary by country and by bank. Ask for the timeline in writing; it is often the longest lead time here.
2. Ask each provider for one number: what LANDS in the destination account. Rate, fee, and landed amount on the same written quote.
3. Compare that rate against the mid-market (interbank) rate from a source that is not the provider's own page. Record the source and the timestamp beside each quote — mid-market rates differ by source and by minute, so only quotes taken together compare.
4. Take 2-3 quotes inside the same hour on the same amount: your existing bank, a licensed money-transfer operator, an FX broker. Quotes from different days do not compare.
5. Ask in writing whether correspondent banks deduct anything en route, who pays that, and the value date the recipient can use the money.
6. Send a small transfer first and confirm it landed before sending the balance. A test proves the account number reaches an account, not that the name on it is yours. Ask the provider whether the beneficiary name is checked on this route, and what its recall process is when money reaches a valid account belonging to someone else.
7. Fraud rule, no exceptions: any payment instruction or account-detail change arriving by email or message gets verified by phone on a number you already hold — your statement or the institution's official site, never a number in the message. Read the beneficiary name and account number back on the call.
8. Do not let a deposit or first rent depend on same-day arrival. Settlement time varies by provider, corridor, and rail — get the expected value date in writing for your currency pair, and ask which holiday calendars apply: the sending country, the receiving country, and the country whose currency clears the payment.
9. Ask each provider what transfer size triggers compliance and source-of-funds checks and exactly which documents it wants. Thresholds are provider- and country-specific. Gather those documents before you send.

Sending from the US: look the provider up on FinCEN's MSB registrant search, and ask which state money transmitter license covers you, then confirm it on NMLS Consumer Access. A listing means a filing or a license, not approval or endorsement. A bank itself is not an MSB registrant, so its absence is not by itself a red flag — but a bank's separately-incorporated transfer subsidiary can be required to register; confirm the exact entity you are paying, so a bank's absence there is not a red flag. Sending from elsewhere, check that country's own financial regulator's register.

We quote no rates, fees, or limits — collect every one in writing from each provider, and keep the quotes. We send nothing on your behalf.""",
)

register(
    'contacts_notify',
    'Who to tell about your new address',
    """Nothing here is sent for you — Relocate holds no contact list. Copy the block, edit it, send it from your own account.

--- announcement (email or text) ---
Subject: New address as of {move_date}

We've moved. As of {move_date}, our address is:

{destination_address}

Please update your address book.

{user_name}
--- end ---

Edit the block before you send it — it asserts nothing we cannot confirm:
1. If your phone or email also changed, add a line saying so.
2. Optionally add a line about the new place, or when people can visit.

Who gets it one-to-one — they will actually mail or ship something:
3. Family who send cards, checks, or gifts
4. Your emergency contacts, and whoever holds a spare key
5. Anyone who lists you as their contact on a school, work, or medical form
6. Anyone currently holding your mail, packages, or documents

One group message for everyone else:
7. Colleagues, neighbors, group chats. Neighborhood and city is enough; give the street address one-to-one when someone asks.
8. BCC the group email — To or CC exposes every recipient's email address to everyone on the message. BCC exists only in email; a group text shows every number to everyone, so send those one at a time or use a broadcast list.

Then:
9. Keep the street address off public posts, and check images before posting — package labels, mail, and lease pages carry it. Don't post photos of your keys either; the cut pattern can be copied.
10. Update the saved default shipping address on shopping and delivery accounts before your next order goes out, then check pending and recurring orders separately — changing the default does not redirect an order already placed, and some retailers ask for the address at checkout instead of storing one.
11. Telling people is separate from mail forwarding, and forwarding is a backstop, not a substitute for people updating their records. Moving within the US, mail forwards only if you file a USPS change of address: online at usps.com/move, by phone at 1-800-275-8777, or in person at a Post Office. The online filing charges an identity-verification fee — confirm the current amount, the ID you need, and whether the phone and counter channels charge one, at usps.com/move or your local Post Office. Moving abroad, ask the postal service in each country what it forwards and for how long.
""",
)
PLAYBOOKS['contacts_notify'] = (
    'New-address announcement (ready to send)',
    """Nothing here is sent for you. Copy the block, fill the gaps, send it from your own account.

--- announcement (email or text) ---
Subject: New address as of <your move date>

We've moved. As of <your move date>, our address is:

<your new address>

Please update your address book.

<your name>
--- end ---

Edit the block before you send it — it asserts nothing we cannot confirm:
1. If your phone or email also changed, add a line saying so.
2. Optionally add a line about the new place, or when people can visit.

3. One-to-one: family who mail cards, checks, or gifts; your emergency contacts; whoever holds a spare key; anyone holding your mail or documents.
4. One group message for everyone else — neighborhood and city is enough; give the street address when someone asks.
5. BCC the group email — To or CC exposes every recipient's email address to everyone on the message. BCC exists only in email; a group text shows every number to everyone, so send those one at a time or use a broadcast list.
6. Keep the street address off public posts, and check images first — package labels, mail, and lease pages carry it. Don't post photos of your keys either; the cut pattern can be copied.
7. Update the saved default shipping address on shopping and delivery accounts before your next order goes out, then check pending and recurring orders separately — changing the default does not redirect an order already placed.
8. Telling people is separate from mail forwarding. Moving within the US, mail forwards only if you file a USPS change of address: online at usps.com/move, by phone at 1-800-275-8777, or in person at a Post Office. The online filing charges an identity-verification fee — confirm the current amount and the ID requirements at usps.com/move before you file. Moving abroad, ask the postal service in each country what it forwards.
""",
)

register(
    'grocery_setup',
    'Food and essentials for the first 48 hours',
    """Three things go wrong in the first 48 hours: no soap, no dinner, and a pantry you pay for twice.

First-night box — it travels with you, not on the truck. Pack it last, label it:
1. Toilet paper, paper towels, trash bags, hand soap, dish soap, sponge
2. Medications, chargers, one towel and one set of sheets per person, one change of clothes
3. Flashlight, light bulbs, disposable plates and forks
4. Box cutter, screwdriver
5. Coffee or tea you can make without the machine that got packed
6. If you are flying, this box rides in checked baggage or in the car — not a carry-on. US carry-on rules bar box cutters and razor blades and cap liquids at 3.4 oz / 100 ml per container, so full-size soap does not make it through. Check anything you are unsure about on tsa.gov "What Can I Bring?" before you pack, or plan to buy the tools and the soap after you land

Day one at {destination_address}:
7. Before you travel, find the nearest full-size grocery and one late-hours option, and check their hours for arrival day on the chain's own site — hours vary by location, and 10pm is the wrong time to learn them
8. If you want delivery the day you land, check first on the service's own site that it delivers to your new ZIP and whether same-day slots require a paid membership. Coverage varies by market, and Amazon same-day grocery generally sits behind Prime. Options to check: the grocery chain's own app, Instacart, Amazon
9. Then create the account, save {destination_address} with unit number and gate code plus a billing address that matches your card, and re-open account settings to confirm all of it saved. A missing unit number or a mismatched billing address are the usual reasons a first order to a new address gets rejected. An account is not a reserved slot — book the slot itself once you know your arrival time
10. Plan one meal out on arrival night. Cooking loses to unpacking on day one

Not paying for the pantry twice:
11. Ask your mover for its non-allowables list before packing day, and read it. Perishables, open containers, and hazardous items (aerosols, flammables, propane, lighter fluid) are commonly excluded, but the list that governs your shipment is your mover's, not one national rule. Start eating down the fridge and freezer as soon as your mover confirms the packing date
12. Move sealed, unopened staples you would re-buy anyway. Leave oil, vinegar, and anything else that can leak even where the mover allows it — one broken bottle costs more than the bottle. Anything you are unsure about, check against the non-allowables list from item 11
13. Donate what you are not taking to a local food bank — many accept unopened, in-date non-perishables; check the accepted-items list on their site before you box anything up
14. Restock in two passes: one week of staples on arrival, the full shop once the kitchen is unpacked. You cannot see what you already own until the boxes are open

Relocate does not order groceries, reserve a delivery slot, or buy anything for you. This is the list; you run it.""",
)
PLAYBOOKS['grocery_setup'] = (
    'First-night box and day-one food checklist',
    """Nothing here needs a call, an account with us, or a purchase from us — it is an order of operations for the first 48 hours.

Pack a first-night box that travels with you, not on the truck. Label it, load it last:
1. Toilet paper, paper towels, trash bags, hand soap, dish soap, sponge
2. Medications, chargers, one towel and one set of sheets per person, one change of clothes
3. Flashlight, light bulbs, disposable plates and forks, box cutter, screwdriver
4. Coffee or tea you can make without the machine that got packed
5. Flying? Put this box in the car or in checked baggage, not a carry-on: US carry-on rules bar box cutters and razor blades and cap liquids at 3.4 oz / 100 ml per container. Check anything you are unsure about on tsa.gov "What Can I Bring?", or buy the tools and the soap after you land

Before you travel:
6. Look up the nearest full-size grocery to {destination_address} plus one late-hours option, and confirm arrival-day hours on the chain's own site
7. Want delivery the day you land? Confirm on the service's own site that it delivers to your new ZIP and whether same-day slots need a paid membership — coverage varies by market, and Amazon same-day grocery generally sits behind Prime. Then create the account, save the new address (unit number, gate code, card billing address), and re-open account settings to check it all saved. Do this before {move_date}, not at 10pm on arrival night. An account is not a reserved slot. Options to check: the grocery chain's own app, Instacart, Amazon
8. Ask your mover for its non-allowables list and read it — what is excluded is that mover's call, not one national rule. Perishables, open containers, aerosols, and flammables are commonly barred. Start eating down the fridge and freezer as soon as your mover confirms the packing date

On arrival:
9. Eat one meal out the first night. Cooking loses to unpacking on day one
10. Buy one week of staples only, then do the full shop after the kitchen is unpacked and you can see what already came with you
11. Sealed food you would not re-buy goes to a local food bank instead of on the truck — check their accepted-items list first. Skip oil, vinegar, and anything else that can leak even where your mover allows it

Relocate places none of these orders for you.""",
)

register(
    'commute_route',
    'Commute route, both directions',
    """Home: {destination_address}
Work: {work_address}

1. Look up each leg with a departure time set, not "now". If your map app offers a depart-at / arrive-by option, use it — Google Maps has one for driving and transit; Apple Maps' options vary by version and travel mode, so check what yours actually offers. An off-peak lookup can badly understate a rush-hour commute.
2. Run the two legs separately: home -> work at the hour you actually start, work -> home at the hour you actually leave. They often do not mirror each other.
3. Check at least two different weekdays, including one midweek day. Plan against the slower number, not the average.
4. Transit: if the destination has a transit agency that publishes its own trip planner, run the same pair there. That planner covers only that agency's network — if your trip spans two operators, use the regional planner or a multi-agency app instead. Count the whole door-to-door chain — walk, wait, ride, transfer, walk — and compare THAT to the driving number, not the in-vehicle time.
5. Before you rely on transit for late days, find the last outbound trip on that route on the agency's published schedule, for the day of the week you would actually be travelling. Last trips differ by weekday, Saturday, Sunday and holiday service, and some systems run overnight.
6. Parking at work: ask your employer what parking exists, what it costs you, and whether there is a transit or vanpool benefit. Ask before day one, not after.
7. Parking at home: find whichever body runs on-street parking on that block — in the US that may be the city, the county, a township or borough, or a separate parking authority; it can also be a university district, an HOA or a private lot, and many blocks have no permit program at all. Check that body's own page for {destination_address}: permit-only or not, what a permit requires, what it costs. Third-party summaries go stale.
8. Tolls: note which of your routes are tolled, then check on the operator's own site whether they require a transponder account, bill by plate, or accept a transponder you already hold. If an account is required, open it yourself.
9. Fallback: if there is an alternate that avoids the main route's chokepoint (bridge, tunnel, single freeway), pick one and save both in your map app so you can switch without thinking. If there genuinely is no alternate, build buffer time into the schedule instead.
10. Trial run: after {move_date}, drive or ride the real route at the real time before you commit to a schedule. One real trip is the best single check you can make, but it is still one day — weather, an incident, a holiday week or school being out can skew it. Repeat it if the number surprises you.

Relocate does not buy passes, permits, or toll accounts. Confirm the numbers at the source and set the accounts up yourself.""",
)
PLAYBOOKS['commute_route'] = (
    'Commute route checklist',
    """Home: (write in your new address)
Work: (write in your work address)

1. Look up each leg with a departure time set, not "now". If your map app offers a depart-at / arrive-by option, use it — Google Maps has one for driving and transit; Apple Maps' options vary by version and travel mode, so check what yours offers. Off-peak lookups can badly understate the commute.
2. Time home -> work at your real start hour and work -> home at your real leave hour, separately. The two legs often do not mirror each other.
3. Check at least two different weekdays, including one midweek day, and plan against the slower number.
4. Transit: if the destination has a transit agency that publishes its own trip planner, run the same pair there and count door-to-door — walk, wait, ride, transfer, walk. That planner covers only that agency's network; for a trip spanning two operators use the regional planner or a multi-agency app. Also find the last trip of the night on the agency's published schedule for the day of the week you would actually travel — it differs by weekday, Saturday, Sunday and holiday service.
5. Parking at work: ask your employer what parking exists, what it costs, and whether a transit benefit applies.
6. Parking at home: find whichever body runs on-street parking on that block — in the US that may be the city, the county, a township or borough, or a separate parking authority, and it can also be an HOA or private lot, or no program at all. Check that body's own page for the new address: permit-only or not, requirements, cost.
7. Tolls: note which routes are tolled, then check on the operator's own site whether they require a transponder account, bill by plate, or accept a transponder you already hold. If an account is required, open it yourself.
8. Pick one fallback route that avoids the main chokepoint, if one exists, and save both. If there is no alternate, build buffer time into the schedule instead.
9. Drive or ride it once at the real time before you commit to a schedule. It is the best single check you can make, but it is one day — repeat it if the number surprises you.

Relocate does not buy passes, permits, or toll accounts — you confirm and set those up.""",
)

register(
    'furniture_setup',
    'Furnishing the new place',
    """Furnishing {destination_address}. We place no orders, book no deliveries, and schedule no pickups — every step below is yours to execute. Run them in this order.

1. Measure the PATH, not the room: clear width of the narrowest door, width and ceiling height of the tightest stair or hallway turn, and — if there's an elevator — its door opening, car depth, and car diagonal. Keep those numbers on your phone and shop against them.
2. Match each piece to the right set of numbers. Flat-pack ships boxed, so the CARTON dimensions govern. Anything that arrives assembled — sofas, upholstered chairs, most white-glove case goods — comes wrapped, not boxed, so its ASSEMBLED width, height, and diagonal depth govern. Check which set the listing is actually giving you; if the number you need isn't there, ask the seller before you order.
3. Ask the landlord or building manager at {destination_address} what deliveries require — reserved elevator or loading window, a certificate of insurance from the carrier, permitted hours. Get that answer before you order, not after.
4. Order the essentials — beds, a table, seating — to land AFTER {move_date}, and get the ship-by date in writing before you pay. Mattresses go both ways — roll-packed in a carton or delivered full size — so check which the listing means. Made-to-order and upholstered pieces are the ones to order before you arrive.
5. Don't schedule any furniture delivery for {move_date} itself — your movers will own the doorway.
6. At checkout, ask exactly what the delivery price includes: left at the door, carried to the room you name, or assembled with the packaging taken away. Ask separately what assembly costs and whether they will haul away your old piece — those are often priced apart from the delivery.
7. Buying used from someone you don't know: hard surfaces only — wood, metal, glass. No upholstery, mattresses, or box springs off a curb or out of a home you haven't walked through. Cribs: new only. Inspect frame joints, drawer runners, legs, and glass edges with a flashlight, in daylight, with a second person; seams and tufting are worth checking only on upholstery you're buying out of a home you've seen. Usual sources are local resale (Facebook Marketplace, Craigslist, Nextdoor), estate sales, and office liquidators.
8. Before money changes hands on a used dresser or bookcase, check it against your country's product-safety recall database — in the US that's cpsc.gov/recalls. Anchor tall units to the wall once they're in, using the anchor kit that matches your wall type (wood stud, metal stud, drywall, concrete, masonry), and check your lease before you drill.
9. Decide what you are NOT taking as soon as you have the move date — the lead time you get quoted sets your real deadline. Call each charity you're considering (Salvation Army, Habitat for Humanity ReStore, Goodwill) and ask three things: whether they pick up at your address at all, what they will and won't accept, and how far out they're currently booking. Not every location runs residential furniture pickup. Ask for an itemized, dated receipt for whatever they take.
10. For the rest, check your current city's bulky-item pickup rules on its sanitation or public-works site, and ask specifically how mattresses are handled. What a landlord may charge for property left in the unit is set by your lease and by local landlord-tenant law — read the lease before you decide to leave anything, and if you do leave something, get the landlord's agreement in writing.""",
)
PLAYBOOKS['furniture_setup'] = (
    'Furniture ordering checklist',
    """Order nothing until the path measurements are on your phone: clear width of the narrowest door, width and ceiling height of the tightest stair or hallway turn, and — if there's an elevator — its door opening, car depth, and car diagonal.

1. New address: <your new address>. Move date: <your move date>.
2. Match the piece to the right numbers: CARTON dimensions for flat-pack; ASSEMBLED width, height, and diagonal depth for anything that ships assembled (sofas, upholstered chairs, white-glove case goods). Check which set the listing gives you; if the number you need isn't there, ask the seller before ordering.
3. Before ordering, ask the landlord or building manager what deliveries require — reserved elevator or loading window, a certificate of insurance from the carrier, permitted hours.
4. Order beds, a table, and seating to land after the move date, and get the ship-by date in writing before paying. Made-to-order and upholstered pieces are the ones to order before you arrive.
5. Don't schedule any delivery for move day itself — your movers will own the doorway.
6. At checkout, ask exactly what the delivery price includes: left at the door, carried to the room you name, or assembled with packaging taken away. Ask separately what assembly costs and whether they haul away the old piece.
7. Used, from sellers you don't know: hard surfaces only (wood, metal, glass). No upholstery, mattresses, or box springs off a curb or out of a home you haven't walked through. Cribs: new only. Inspect frame joints, drawer runners, and glass edges with a flashlight, in daylight, with a second person. Check used dressers and bookcases against your country's product-safety recall database — in the US, cpsc.gov/recalls. Anchor tall units with the kit that matches your wall type, and check your lease before drilling.
8. Leaving things behind: list for resale, or call charities (Salvation Army, Habitat for Humanity ReStore, Goodwill) and ask whether they pick up at your address, what they'll accept, and how far out they're booking — not every location runs furniture pickup. Get an itemized, dated receipt. Check your city's bulky-item rules on its sanitation or public-works site and ask how mattresses are handled. What a landlord may charge for property left in the unit is set by your lease and local landlord-tenant law — read the lease, and get the landlord's agreement in writing before leaving anything.

We place none of these orders and book none of these pickups — you do.""",
)
