// #dev/components: a QA page for the theme, density and hover-card building blocks, so they can be checked in both
// themes before any view uses them. Not in the tab bar; the sample text below is placeholder, not data.
import { DENSITY_TOGGLE_ENABLED, DensityControl, Detailed, SimpleOnly, useDensity } from '../density'
import { HoverCard, InfoTip } from '../hovercard'
import { ThemeControl, useTheme } from '../theme'
import './devComponents.css'

const TOKENS = ['--bg', '--surface', '--surface-2', '--border', '--border-strong', '--text', '--text-2', '--muted', '--accent', '--accent-soft', '--pos', '--neg', '--warn-bg', '--ok-bg', '--bad-bg', '--info-bg', '--neutral-bg']

const LONG =
  'A longer plain-text tooltip, to check wrapping: it should stay inside the viewport with an 8 px margin, sit below its trigger unless that would cross the bottom edge, and flip above it there.'

function RichSample({ title }: { title: string }) {
  return (
    <div className="dev-rich">
      <strong>{title}</strong>
      <table className="tbl tbl-compact">
        <tbody>
          <tr>
            <th scope="row">Row one</th>
            <td className="num">1.23</td>
          </tr>
          <tr>
            <th scope="row">Row two</th>
            <td className="num">45.6</td>
          </tr>
        </tbody>
      </table>
      <p className="small muted">Rich content is a non-modal popover: Tab from the trigger moves into it.</p>
      <a href="#dev/components">A link inside the card</a>
    </div>
  )
}

export default function DevComponentsView() {
  const { pref, theme } = useTheme()
  const { density } = useDensity()
  return (
    <section className="view dev">
      <div className="view-head">
        <h1>Component check</h1>
        <p className="lede">
          QA page for the theme, density and hover-card building blocks. It is not linked from the tab bar.
        </p>
      </div>

      <div className="card">
        <h2>Theme</h2>
        <div className="dev-row">
          <ThemeControl />
          <span className="small" data-qa="theme-readout">
            Preference <strong>{pref}</strong> · showing <strong>{theme}</strong>
          </span>
        </div>
        <div className="dev-swatches">
          {TOKENS.map((t) => (
            <span key={t} className="dev-swatch">
              <i style={{ background: `var(${t})` }} />
              {t}
            </span>
          ))}
        </div>
      </div>

      <div className="card">
        <h2>Density</h2>
        <div className="dev-row">
          <DensityControl />
          <span className="small" data-qa="density-readout">
            Showing <strong>{density}</strong> · header switch {DENSITY_TOGGLE_ENABLED ? 'on' : 'off'} (DENSITY_TOGGLE_ENABLED)
          </span>
        </div>
        <Detailed>
          <p data-qa="detailed-only">Detailed only: this paragraph is wrapped in &lt;Detailed&gt;.</p>
        </Detailed>
        <SimpleOnly>
          <p data-qa="simple-only">Simple only: this paragraph is wrapped in &lt;SimpleOnly&gt;.</p>
        </SimpleOnly>
      </div>

      <div className="card">
        <h2>Hover cards</h2>
        <div className="dev-grid">
          <p>
            Icon tip with plain text <InfoTip label="About the plain tip" content="Plain text: role=tooltip, linked with aria-describedby." />
          </p>
          <p>
            A <HoverCard content="Plain text on a text trigger.">text trigger</HoverCard> inside a sentence.
          </p>
          <p>
            Rich card on <HoverCard content={<RichSample title="Rich card" />}>a text trigger</HoverCard>, with a link to Tab into.
          </p>
          <p>
            Long text <InfoTip label="About wrapping" content={LONG} />
          </p>
        </div>
        <div className="dev-edge">
          <InfoTip label="Left edge tip" content="Clamped 8 px from the left edge." />
          <InfoTip label="Right edge tip" content={LONG} />
        </div>
      </div>

      <div className="card">
        <h2>Inside a horizontal scroller</h2>
        <p className="small muted">
          The box scrolls sideways (overflow: auto), like the overlap matrix; the cards are portalled to the page, so
          the box does not clip them. Scroll to the end for the right-hand tips.
        </p>
        <div className="dev-scroller" data-qa="scroller">
          <div className="dev-scroller-inner">
            <span>
              Start <InfoTip label="Scroller start tip" content="Inside the scroller, at its start." />
            </span>
            <span>
              Middle <HoverCard content={<RichSample title="Rich card in the scroller" />}>rich trigger</HoverCard>
            </span>
            <span>
              End <InfoTip label="Scroller end tip" content={LONG} />
            </span>
          </div>
        </div>
      </div>

      {/* Fixed to the bottom-right corner, so a scroller-held tip sits at both viewport edges at any window size. */}
      <div className="dev-dock">
        <span className="small muted">Edge dock</span>
        <div className="dev-dock-scroller" data-qa="dock">
          <div className="dev-dock-inner">
            <InfoTip label="Dock start tip" content="In the edge dock's scroller, at its start." />
            <InfoTip label="Dock end tip" content={LONG} />
          </div>
        </div>
      </div>
    </section>
  )
}
