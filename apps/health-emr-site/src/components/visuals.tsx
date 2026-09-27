/**
 * The page's pictures.
 *
 * Hand-authored SVG rather than screenshots: a console screenshot of a system
 * holding patient data either shows real people or shows obvious fakes, and
 * both are worse than a drawing of the mechanism. Each of these depicts
 * something the prose beside it claims, so a reader can check the claim against
 * the picture instead of taking it on trust.
 *
 * All of them draw in `currentColor` so they inherit the band they sit in, with
 * the brand reserved for the one element carrying the argument.
 */

/** A visit meeting the roster: two gates, and who survives them. */
export function RoutingVisual({ className }: { className?: string }) {
  const rows = [
    { name: 'Licensed in TX · weight mgmt', ok: true },
    { name: 'Licensed in TX · sexual health', ok: false, why: 'not credentialled' },
    { name: 'Licensed in CA · weight mgmt', ok: false, why: 'wrong state' },
    { name: 'Licence expired', ok: false, why: 'not current' },
  ];
  return (
    <svg
      viewBox="0 0 520 300"
      role="img"
      aria-label="A visit from a patient in Texas is offered only to clinicians holding a current Texas licence and credentialled for the treatment; three of the four candidates are refused, for the wrong state, the wrong credential and an expired licence."
      className={className}
      style={{ maxWidth: '100%', height: 'auto' }}
    >
      <defs>
        <marker id="rv-arrow" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto">
          <polygon points="0,1 8,4.5 0,8" fill="currentColor" opacity="0.55" />
        </marker>
      </defs>

      <rect x="4" y="118" width="128" height="58" rx="12" fill="none" stroke="currentColor" strokeOpacity="0.25" />
      <text x="68" y="143" textAnchor="middle" fontSize="13" fill="currentColor" fontWeight="600">
        Visit
      </text>
      <text x="68" y="161" textAnchor="middle" fontSize="11" fill="currentColor" opacity="0.55">
        patient in TX
      </text>

      <line x1="134" y1="147" x2="176" y2="147" stroke="currentColor" strokeOpacity="0.4" strokeWidth="1.4" markerEnd="url(#rv-arrow)" />

      <rect x="178" y="104" width="104" height="86" rx="12" fill="var(--brand)" fillOpacity="0.08" stroke="var(--brand)" strokeOpacity="0.5" />
      <text x="230" y="132" textAnchor="middle" fontSize="12" fill="var(--brand)" fontWeight="600">
        Licence
      </text>
      <text x="230" y="150" textAnchor="middle" fontSize="12" fill="var(--brand)" fontWeight="600">
        + credential
      </text>
      <text x="230" y="170" textAnchor="middle" fontSize="10.5" fill="var(--brand)" opacity="0.75">
        cannot be waived
      </text>

      <line x1="284" y1="147" x2="322" y2="147" stroke="currentColor" strokeOpacity="0.4" strokeWidth="1.4" markerEnd="url(#rv-arrow)" />

      {rows.map((row, index) => {
        const y = 56 + index * 54;
        return (
          <g key={row.name}>
            <rect
              x="324"
              y={y}
              width="192"
              height="40"
              rx="10"
              fill="none"
              stroke={row.ok ? 'var(--brand)' : 'currentColor'}
              strokeOpacity={row.ok ? 0.65 : 0.16}
            />
            <text
              x="340"
              y={y + 18}
              fontSize="11"
              fill={row.ok ? 'var(--brand)' : 'currentColor'}
              opacity={row.ok ? 1 : 0.45}
              fontWeight={row.ok ? 600 : 400}
            >
              {row.name}
            </text>
            <text
              x="340"
              y={y + 32}
              fontSize="10"
              fill={row.ok ? 'var(--brand)' : 'currentColor'}
              opacity={row.ok ? 0.8 : 0.35}
            >
              {row.ok ? 'eligible — assigned' : row.why}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/** The life of a visit, as a single horizontal run with its side branches. */
export function PipelineVisual({ className }: { className?: string }) {
  const stages = ['Submitted', 'Routed', 'Reviewed', 'Signed', 'Shipped'];
  return (
    <svg
      viewBox="0 -14 640 200"
      role="img"
      aria-label="A visit moves from submitted, to routed, to reviewed, to signed, to shipped. From review it may instead be declined, or sent back to the patient for more information and then return to the queue."
      className={className}
      style={{ maxWidth: '100%', height: 'auto' }}
    >
      <defs>
        <marker id="pv-arrow" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto">
          <polygon points="0,1 8,4.5 0,8" fill="currentColor" opacity="0.5" />
        </marker>
      </defs>

      <line x1="20" y1="48" x2="620" y2="48" stroke="currentColor" strokeOpacity="0.14" strokeWidth="1.2" />

      {stages.map((stage, index) => {
        const x = 40 + index * 140;
        const isSigned = stage === 'Signed';
        return (
          <g key={stage}>
            <circle
              cx={x}
              cy="48"
              r="9"
              fill={isSigned ? 'var(--brand)' : 'currentColor'}
              fillOpacity={isSigned ? 1 : 0.22}
            />
            <text
              x={x}
              y="80"
              textAnchor="middle"
              fontSize="12.5"
              fontWeight="600"
              fill={isSigned ? 'var(--brand)' : 'currentColor'}
              opacity={isSigned ? 1 : 0.8}
            >
              {stage}
            </text>
          </g>
        );
      })}

      <text x="460" y="98" textAnchor="middle" fontSize="10.5" fill="var(--brand)" opacity="0.8">
        the legal moment
      </text>

      {/* The two branches are separated above and below the line. Drawn on the
          same side they crossed each other, and a diagram whose lines collide
          is read as one path rather than two. */}
      <path d="M320 58 L320 112" stroke="currentColor" strokeOpacity="0.3" strokeWidth="1.2" markerEnd="url(#pv-arrow)" />
      <text x="334" y="118" fontSize="11" fill="currentColor" opacity="0.5">
        Declined, with a reason on the record
      </text>

      <path
        d="M320 38 C 300 6, 200 6, 180 36"
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.32"
        strokeWidth="1.2"
        strokeDasharray="4 4"
        markerEnd="url(#pv-arrow)"
      />
      <text x="250" y="160" textAnchor="middle" fontSize="11" fill="currentColor" opacity="0.5">
        More information needed — back to the queue when they answer
      </text>
    </svg>
  );
}

/** The record: one chart, many contributors. */
export function RecordVisual({ className }: { className?: string }) {
  const sources = ['Intake answers', 'Allergies', 'Decisions', 'Prescriptions', 'Shipments', 'Messages'];
  return (
    <svg
      viewBox="0 0 520 300"
      role="img"
      aria-label="Intake answers, allergies, decisions, prescriptions, shipments and messages all attach to one patient record, and every read of it is recorded."
      className={className}
      style={{ maxWidth: '100%', height: 'auto' }}
    >
      <rect x="196" y="104" width="128" height="92" rx="16" fill="var(--brand)" fillOpacity="0.08" stroke="var(--brand)" strokeOpacity="0.55" />
      <text x="260" y="140" textAnchor="middle" fontSize="13" fontWeight="600" fill="var(--brand)">
        One record
      </text>
      <text x="260" y="160" textAnchor="middle" fontSize="11" fill="var(--brand)" opacity="0.75">
        per patient
      </text>
      <text x="260" y="178" textAnchor="middle" fontSize="10" fill="var(--brand)" opacity="0.6">
        every read logged
      </text>

      {sources.map((source, index) => {
        const left = index % 2 === 0;
        const row = Math.floor(index / 2);
        const x = left ? 8 : 356;
        const y = 58 + row * 82;
        const anchorX = left ? 164 : 356;
        const targetX = left ? 196 : 324;
        return (
          <g key={source}>
            <rect x={x} y={y} width="156" height="42" rx="10" fill="none" stroke="currentColor" strokeOpacity="0.18" />
            <text x={x + 78} y={y + 26} textAnchor="middle" fontSize="11.5" fill="currentColor" opacity="0.75">
              {source}
            </text>
            <line
              x1={left ? anchorX : anchorX}
              y1={y + 21}
              x2={targetX}
              y2={150}
              stroke="currentColor"
              strokeOpacity="0.16"
              strokeWidth="1.1"
            />
          </g>
        );
      })}
    </svg>
  );
}

/** Security, as the layers a request passes through. */
export function SecurityVisual({ className }: { className?: string }) {
  const layers = [
    { label: 'Session held server-side', detail: 'the token never reaches page scripts' },
    { label: 'Role checked twice', detail: 'before render, and again at the API' },
    { label: 'Tenant applied by the data layer', detail: 'not by remembering to filter' },
    { label: 'Identifying fields encrypted', detail: 'AES-256-GCM, before storage' },
    { label: 'Every access hash-chained', detail: 'an edit breaks the chain' },
  ];
  return (
    <svg
      viewBox="0 0 520 330"
      role="img"
      aria-label="A request passes through five layers: the session is held server-side, the role is checked twice, tenant separation is applied by the data layer, identifying fields are encrypted before storage, and every access is written to a hash-chained trail."
      className={className}
      style={{ maxWidth: '100%', height: 'auto' }}
    >
      <defs>
        <marker id="sv-arrow" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto">
          <polygon points="0,1 8,4.5 0,8" fill="currentColor" opacity="0.4" />
        </marker>
      </defs>
      {layers.map((layer, index) => {
        const y = 12 + index * 62;
        const last = index === layers.length - 1;
        return (
          <g key={layer.label}>
            <rect
              x="16"
              y={y}
              width="488"
              height="46"
              rx="12"
              fill={last ? 'var(--brand)' : 'currentColor'}
              fillOpacity={last ? 0.08 : 0.04}
              stroke={last ? 'var(--brand)' : 'currentColor'}
              strokeOpacity={last ? 0.5 : 0.16}
            />
            <text
              x="36"
              y={y + 21}
              fontSize="12.5"
              fontWeight="600"
              fill={last ? 'var(--brand)' : 'currentColor'}
              opacity={last ? 1 : 0.85}
            >
              {layer.label}
            </text>
            <text
              x="36"
              y={y + 36}
              fontSize="11"
              fill={last ? 'var(--brand)' : 'currentColor'}
              opacity={last ? 0.75 : 0.5}
            >
              {layer.detail}
            </text>
            {!last ? (
              <line
                x1="260"
                y1={y + 46}
                x2="260"
                y2={y + 60}
                stroke="currentColor"
                strokeOpacity="0.3"
                strokeWidth="1.2"
                markerEnd="url(#sv-arrow)"
              />
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}

/** The commercial shape: one platform, many brands, one clinician network. */
export function NetworkVisual({ className }: { className?: string }) {
  const brands = ['Brand A', 'Brand B', 'Brand C'];
  const partners = ['Clinicians', 'Pharmacies'];
  return (
    <svg
      viewBox="0 0 520 280"
      role="img"
      aria-label="Several telehealth brands each keep their own patients and catalogue, and all draw on one shared network of licensed clinicians and contracted pharmacies. No brand can see another brand's records."
      className={className}
      style={{ maxWidth: '100%', height: 'auto' }}
    >
      {brands.map((brand, index) => {
        const x = 12 + index * 168;
        return (
          <g key={brand}>
            <rect x={x} y="10" width="152" height="52" rx="12" fill="none" stroke="currentColor" strokeOpacity="0.2" />
            <text x={x + 76} y="33" textAnchor="middle" fontSize="12.5" fontWeight="600" fill="currentColor" opacity="0.85">
              {brand}
            </text>
            <text x={x + 76} y="50" textAnchor="middle" fontSize="10.5" fill="currentColor" opacity="0.45">
              own patients · own prices
            </text>
            <line x1={x + 76} y1="62" x2="260" y2="104" stroke="currentColor" strokeOpacity="0.14" strokeWidth="1.1" />
          </g>
        );
      })}

      <rect x="132" y="106" width="256" height="58" rx="14" fill="var(--brand)" fillOpacity="0.08" stroke="var(--brand)" strokeOpacity="0.55" />
      <text x="260" y="132" textAnchor="middle" fontSize="13" fontWeight="600" fill="var(--brand)">
        HealthEMR
      </text>
      <text x="260" y="150" textAnchor="middle" fontSize="10.5" fill="var(--brand)" opacity="0.75">
        separated in the data layer, not by convention
      </text>

      {partners.map((partner, index) => {
        const x = 78 + index * 216;
        return (
          <g key={partner}>
            <line x1="260" y1="164" x2={x + 76} y2="206" stroke="currentColor" strokeOpacity="0.14" strokeWidth="1.1" />
            <rect x={x} y="208" width="152" height="52" rx="12" fill="none" stroke="currentColor" strokeOpacity="0.2" />
            <text x={x + 76} y="231" textAnchor="middle" fontSize="12.5" fontWeight="600" fill="currentColor" opacity="0.85">
              {partner}
            </text>
            <text x={x + 76} y="248" textAnchor="middle" fontSize="10.5" fill="currentColor" opacity="0.45">
              shared across every brand
            </text>
          </g>
        );
      })}
    </svg>
  );
}
