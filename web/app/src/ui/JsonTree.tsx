// Collapsible read-only JSON tree. Branches deeper than `openDepth` start closed.
import { useState } from 'react'
import { jsonChildren, jsonLeaf, jsonSummary } from './jsonTreeModel'

interface NodeProps {
  name: string
  value: unknown
  depth: number
  openDepth: number
}

function JsonNode({ name, value, depth, openDepth }: NodeProps) {
  const children = jsonChildren(value)
  const [open, setOpen] = useState(depth < openDepth)

  if (children === null) {
    const leaf = jsonLeaf(value)
    return (
      <li className="json-row">
        <span className="json-key">{name}:</span> <span className={`json-${leaf.kind}`}>{leaf.text}</span>
      </li>
    )
  }

  return (
    <li className="json-row">
      <button type="button" className="json-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? '▾' : '▸'} <span className="json-key">{name}</span>
        {!open && <span className="json-summary"> {jsonSummary(value)}</span>}
      </button>
      {open && (
        <ul className="json-list">
          {children.map(([k, v]) => (
            <JsonNode key={k} name={k} value={v} depth={depth + 1} openDepth={openDepth} />
          ))}
        </ul>
      )}
    </li>
  )
}

export default function JsonTree({ name, value, openDepth = 1 }: { name: string; value: unknown; openDepth?: number }) {
  return (
    <ul className="json-list json-root">
      <JsonNode name={name} value={value} depth={0} openDepth={openDepth} />
    </ul>
  )
}
