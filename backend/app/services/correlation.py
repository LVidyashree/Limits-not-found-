from typing import List, Dict, Any
from app.models.case import Case
from app.models.evidence import Evidence
from app.models.finding import Finding
from app.schemas.analysis import CorrelatedEntity, EntityGraphNode, EntityGraphEdge, EntityGraphResponse

def correlate_case_evidence(case: Case) -> Dict[str, Any]:
    """
    Synthesizes and correlates findings across all evidence files within a case.
    Identifies common suspects, payment addresses, phone numbers, and accounts appearing
    in multiple evidence pieces to build a complete connected web.
    """
    evidence_map = {e.id: e for e in case.evidence_items}
    findings_by_value: Dict[str, List[Finding]] = {}

    for finding in case.findings:
        # Normalize key for grouping
        key = f"{finding.finding_type}:{finding.finding_value.strip().lower()}"
        if key not in findings_by_value:
            findings_by_value[key] = []
        findings_by_value[key].append(finding)

    # 1. Correlated Entities list
    correlated_entities: List[CorrelatedEntity] = []
    
    for key, findings_group in findings_by_value.items():
        first = findings_group[0]
        evidence_ids = list({f.evidence_id for f in findings_group})
        evidence_names = [evidence_map[eid].original_filename for eid in evidence_ids if eid in evidence_map]
        contexts = [f.context_snippet for f in findings_group if f.context_snippet][:3]

        correlated_entities.append(CorrelatedEntity(
            finding_type=first.finding_type,
            finding_value=first.finding_value,
            label=first.label,
            occurrences_count=len(findings_group),
            evidence_ids=evidence_ids,
            evidence_filenames=evidence_names,
            context_samples=contexts
        ))

    # Sort so most recurring / high impact entities come first
    correlated_entities.sort(key=lambda x: (x.occurrences_count, len(x.evidence_ids)), reverse=True)

    # 2. Build Interactive Entity Graph (Nodes & Edges)
    nodes: List[EntityGraphNode] = []
    edges: List[EntityGraphEdge] = []
    node_ids = set()

    # Add Case Root Node
    case_node_id = f"case_{case.id}"
    nodes.append(EntityGraphNode(
        id=case_node_id,
        label=case.title,
        type="case",
        properties={"category": case.category, "severity": case.severity}
    ))
    node_ids.add(case_node_id)

    # Add Evidence File Nodes
    for e in case.evidence_items:
        ev_node_id = f"ev_{e.id}"
        nodes.append(EntityGraphNode(
            id=ev_node_id,
            label=e.original_filename,
            type="evidence",
            properties={
                "file_type": e.file_type,
                "sha256": e.sha256_hash[:12] + "...",
                "size_bytes": e.file_size
            }
        ))
        node_ids.add(ev_node_id)

        # Connect Case -> Evidence
        edges.append(EntityGraphEdge(
            id=f"edge_case_{e.id}",
            source=case_node_id,
            target=ev_node_id,
            label="CONTAINS_EVIDENCE"
        ))

    # Add Entity Nodes & connect them to Evidence
    for item in correlated_entities:
        entity_node_id = f"ent_{item.finding_type}_{item.finding_value}"
        if entity_node_id not in node_ids:
            nodes.append(EntityGraphNode(
                id=entity_node_id,
                label=item.finding_value,
                type=item.finding_type,
                properties={
                    "occurrences": item.occurrences_count,
                    "connected_files": len(item.evidence_ids)
                }
            ))
            node_ids.add(entity_node_id)

        # Connect Evidence -> Entity
        for eid in item.evidence_ids:
            edges.append(EntityGraphEdge(
                id=f"edge_{eid}_{entity_node_id}",
                source=f"ev_{eid}",
                target=entity_node_id,
                label="EXTRACTED_ENTITY"
            ))

    return {
        "correlated_entities": [c.model_dump() for c in correlated_entities],
        "graph": EntityGraphResponse(nodes=nodes, edges=edges)
    }
