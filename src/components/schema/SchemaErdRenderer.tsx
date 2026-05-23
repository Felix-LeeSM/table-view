import type { SchemaGraph } from "@/types/schemaGraph";

interface SchemaErdRendererProps {
  graph: SchemaGraph;
  selectedTableId?: string;
  onSelectedTableIdChange?: (tableId: string) => void;
}

export default function SchemaErdRenderer({ graph }: SchemaErdRendererProps) {
  return (
    <div role="figure" aria-label="Database relationship diagram">
      ERD pending: {graph.nodes.length} nodes
    </div>
  );
}
