import type React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import ReactFlow, {
  Background,
  ConnectionLineType,
  Controls,
  type Edge,
  type Node,
  useEdgesState,
  useNodesState,
} from "reactflow";
import "reactflow/dist/style.css";
import type { ExecutionStepPayload } from "../../bridge/types";
import type { ExecutionStep } from "../hooks/useTimeTravel";
import { getLayoutedElements } from "../utils/graphLayout";
import { NodeDetails } from "./NodeDetails";
import { AgentNode } from "./nodes/AgentNode";
import { ToolNode } from "./nodes/ToolNode";

const nodeTypes = {
  agent: AgentNode,
  tool: ToolNode,
};

interface ExecutionGraphProps {
  messages: any[];
  currentStepIndex?: number;
  steps?: ExecutionStep[];
}

export function ExecutionGraph({
  messages,
  currentStepIndex = -1,
  steps = [],
}: ExecutionGraphProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);

  // Filter messages based on current step index if time travel is active
  const activeMessages = useMemo(() => {
    if (currentStepIndex === -1 || steps.length === 0) return messages;

    // Find the timestamp of the current step
    const currentStep = steps[currentStepIndex];
    if (!currentStep) return messages;

    // Filter messages that occurred at or before this step's timestamp
    // and are part of the execution flow
    return messages.filter((msg) => {
      if (msg.type !== "SYMPLEK_EXECUTION_STEP") return true;
      return msg.timestamp <= currentStep.timestamp;
    });
  }, [messages, currentStepIndex, steps]);

  useEffect(() => {
    const newNodes: Node[] = [];
    const newEdges: Edge[] = [];

    // Map to track steps and their relationships
    const stepMap = new Map<string, Node>();

    activeMessages.forEach((msg) => {
      if (msg.type === "SYMPLEK_EXECUTION_STEP") {
        const payload = msg.payload as ExecutionStepPayload;

        if (payload.type === "start") {
          const node: Node = {
            id: payload.stepId,
            type: "agent", // Default to agent for now
            data: {
              agentName: payload.agentName,
              status: "running",
              data: payload.data,
            },
            position: { x: 0, y: 0 },
          };

          // Determine if it's a tool call based on name or data
          if (
            payload.agentName.toLowerCase().includes("tool") ||
            (payload.data as any)?.toolName
          ) {
            node.type = "tool";
            node.data.toolName =
              (payload.data as any)?.toolName || payload.agentName;
          }

          newNodes.push(node);
          stepMap.set(payload.stepId, node);

          // Simple linear progression for now
          if (newNodes.length > 1) {
            newEdges.push({
              id: `e-${newNodes[newNodes.length - 2].id}-${node.id}`,
              source: newNodes[newNodes.length - 2].id,
              target: node.id,
              type: ConnectionLineType.SmoothStep,
              animated: true,
              style: { stroke: "#3f3f46" },
            });
          }
        } else if (payload.type === "complete" || payload.type === "error") {
          const existingNode = newNodes.find((n) => n.id === payload.stepId);
          if (existingNode) {
            existingNode.data.status =
              payload.type === "complete" ? "complete" : "error";
            if (payload.data) {
              existingNode.data.data = {
                ...existingNode.data.data,
                ...(payload.data as any),
              };
            }
          }
        }
      }
    });

    const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(
      newNodes,
      newEdges,
    );

    setNodes([...layoutedNodes]);
    setEdges([...layoutedEdges]);
  }, [activeMessages, setNodes, setEdges]);

  const onNodeClick = useCallback((_event: React.MouseEvent, node: Node) => {
    setSelectedNode(node);
  }, []);

  return (
    <div className="w-full h-full relative bg-zinc-950">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        onNodeClick={onNodeClick}
        fitView
        connectionLineType={ConnectionLineType.SmoothStep}
        minZoom={0.1}
        maxZoom={1.5}
      >
        <Background color="#27272a" gap={20} />
        <Controls className="!bg-zinc-900 !border-zinc-800 !fill-zinc-400" />
      </ReactFlow>

      {selectedNode && (
        <NodeDetails
          node={selectedNode}
          onClose={() => setSelectedNode(null)}
        />
      )}
    </div>
  );
}
