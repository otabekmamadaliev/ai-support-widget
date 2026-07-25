import { useEffect } from 'react';
import { CLINIC } from '../shared/clinic.js';
import { mountWidget } from './widget/mount.jsx';

/**
 * The host site.
 *
 * This exists to give the widget somewhere convincing to live — a business a
 * real client might have. It renders entirely from `shared/clinic.js`, the same
 * record the assistant's system prompt is built from, so the prices on the page
 * and the prices the bot quotes can never drift apart.
 */
export default function App() {
  // Mount the widget exactly as a client's site would: one call, no styling and
  // no wiring. StrictMode double-invokes effects in dev, so the teardown matters.
  useEffect(() => mountWidget(), []);

  return (
    <>
      <a className="skip" href="#main">
        Skip to content
      </a>

      <header className="nav">
        <a className="logo" href="#main">
          <span className="logo__mark" aria-hidden="true">
            <Tooth />
          </span>
          <span className="logo__text">
            Northgate<small>Dental Studio</small>
          </span>
        </a>
        <nav className="nav__links" aria-label="Main">
          <a href="#services">Services</a>
          <a href="#team">Our team</a>
          <a href="#hours">Hours</a>
        </nav>
        <div className="nav__right">
          <span className="nav__phone">
            <span className="pulse" aria-hidden="true" />
            {CLINIC.phone}
          </span>
          <a className="btn btn--primary" href="#hours">
            Book a visit
          </a>
        </div>
      </header>

      <main id="main">
        <section className="hero">
          <div className="hero__copy">
            <p className="pill">
              <span aria-hidden="true">★★★★★</span> 4.9 · 812 patient reviews
            </p>
            <h1>
              Dentistry that feels
              <br />
              <em>calm, clear</em> and kind.
            </h1>
            <p className="lead">
              Gentle general, cosmetic and emergency dentistry in central Northgate. Transparent
              prices, same-week appointments, and a team that explains everything before it
              happens.
            </p>
            <div className="hero__cta">
              <a className="btn btn--primary" href="#hours">
                Book an appointment
              </a>
              <a className="btn btn--ghost" href="#services">
                See price list
              </a>
            </div>
            <dl className="hero__stats">
              <div>
                <dt>18 yrs</dt>
                <dd>caring for Northgate</dd>
              </div>
              <div>
                <dt>7 days</dt>
                <dd>average wait for a check-up</dd>
              </div>
              <div>
                <dt>0%</dt>
                <dd>finance over £500</dd>
              </div>
            </dl>
          </div>

          <div className="hero__art" aria-hidden="true">
            <span className="art__blob" />
            <span className="art__ring" />
            <span className="art__tooth" />
            <span className="art__shine" />
            <span className="art__spark art__spark--1">✦</span>
            <span className="art__spark art__spark--2">✦</span>
            <span className="fcard fcard--1">
              <i>🦷</i>
              <span>
                <b>Check-up &amp; clean</b>
                <small>from £65 · 40 min</small>
              </span>
            </span>
            <span className="fcard fcard--2">
              <i>📅</i>
              <span>
                <b>Next free slot</b>
                <small>Thu 30 Jul, 09:20</small>
              </span>
            </span>
            <span className="fcard fcard--3">
              <i>⚡</i>
              <span>
                <b>Emergency same-day</b>
                <small>call before 11:00</small>
              </span>
            </span>
          </div>
        </section>

        <section className="trust" aria-label="Why choose us">
          {[
            ['🛡️', 'GDC registered', 'Every clinician on the UK register.'],
            ['💷', 'Fixed prices', 'Quoted in writing, no surprises.'],
            ['🚸', 'Kids under 6 free', 'With a treating parent.'],
            ['🅿️', 'Parking & step-free', 'Two bays, ground-floor surgery.'],
          ].map(([icon, title, note]) => (
            <div key={title}>
              <h3>
                <span aria-hidden="true">{icon}</span> {title}
              </h3>
              <p>{note}</p>
            </div>
          ))}
        </section>

        <section className="section" id="services">
          <header className="section__head">
            <p className="kicker">What we do</p>
            <h2>Treatments, priced up front</h2>
            <p>Ask the assistant about any of these — it works from the same price list.</p>
          </header>
          <div className="cards">
            {CLINIC.treatments.map((t) => (
              <article className="card" key={t.id}>
                <span className="card__icon" aria-hidden="true">
                  {t.icon}
                </span>
                <h3>{t.name}</h3>
                <p>{t.blurb}</p>
                <p className="card__price">
                  <b>{t.price}</b>
                </p>
              </article>
            ))}
          </div>
        </section>

        <section className="section" id="team">
          <header className="section__head">
            <p className="kicker">Who you'll meet</p>
            <h2>A small team, and you'll know them</h2>
          </header>
          <div className="team">
            {CLINIC.team.map((m) => (
              <article className="person" key={m.name}>
                <span className="person__avatar" aria-hidden="true">
                  {m.name
                    .split(' ')
                    .slice(-2)
                    .map((w) => w[0])
                    .join('')}
                </span>
                <h3>{m.name}</h3>
                <p>{m.role}</p>
                <p className="person__since">With the practice since {m.since}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="band" id="hours">
          <div>
            <h2>
              Open six days a week,
              <br />
              including Saturday mornings.
            </h2>
            <p>
              Call the practice to book, or ask our assistant anything — it knows our prices,
              hours and what to do in an emergency.
            </p>
            <div className="band__cta">
              <a className="btn btn--white" href={`tel:${CLINIC.phone.replace(/\s/g, '')}`}>
                Call {CLINIC.phone}
              </a>
            </div>
          </div>
          <div className="hours">
            <h3>Opening hours</h3>
            <dl>
              {CLINIC.hours.map((h) => (
                <div key={h.days} className={h.closed ? 'is-closed' : undefined}>
                  <dt>{h.days}</dt>
                  <dd>{h.open}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>
      </main>

      <footer className="foot">
        <p>
          © {new Date().getFullYear()} {CLINIC.name} · {CLINIC.address}
        </p>
        <p className="foot__note">
          A fictional practice, built to demo an embeddable AI support widget.
        </p>
      </footer>
    </>
  );
}

function Tooth() {
  return (
    <svg viewBox="0 0 24 26" width="17" height="18" aria-hidden="true" focusable="false">
      <path
        d="M12 1C8.4 1 7.2 2.4 4.6 2.4 2.4 2.4 1 4.6 1 7.9c0 3.6 1.4 5.5 2.3 8.4.7 2.3.6 5.2 1.7 7.4.5 1 1.6 1.5 2.4.9.9-.7 1.1-2.3 1.4-4 .3-1.9.7-3.6 3.2-3.6s2.9 1.7 3.2 3.6c.3 1.7.5 3.3 1.4 4 .8.6 1.9.1 2.4-.9 1.1-2.2 1-5.1 1.7-7.4.9-2.9 2.3-4.8 2.3-8.4 0-3.3-1.4-5.5-3.6-5.5C16.8 2.4 15.6 1 12 1Z"
        fill="currentColor"
      />
    </svg>
  );
}
