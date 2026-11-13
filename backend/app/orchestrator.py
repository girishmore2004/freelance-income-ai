from typing import TypedDict,Any
from langgraph.graph import StateGraph,START,END
from .agents.specialists import matching_agent,research_agent,pricing_agent
class OpportunityState(TypedDict,total=False):
 profile:dict[str,Any]; opportunity:dict[str,Any]; evidence:list[dict[str,Any]]; estimated_hours:float; score:int; breakdown:dict[str,Any]; decision:str; research:dict[str,Any]; pricing:dict[str,Any]
def score_node(s):
 r=matching_agent(s.get("profile",{}),s.get("opportunity",{})); n=r["score"]
 return {"score":n,"breakdown":r["breakdown"],"decision":"prioritize" if n>=70 else "review" if n>=50 else "low_priority"}
def research_node(s): return {"research":research_agent(s.get("evidence",[]))}
def pricing_node(s): return {"pricing":pricing_agent(s.get("opportunity",{}),s.get("estimated_hours",8.0))}
def build_opportunity_graph():
 g=StateGraph(OpportunityState); g.add_node("matching_agent",score_node); g.add_node("research_agent",research_node); g.add_node("pricing_agent",pricing_node); g.add_edge(START,"matching_agent"); g.add_edge("matching_agent","research_agent"); g.add_edge("research_agent","pricing_agent"); g.add_edge("pricing_agent",END); return g.compile()
_graph=build_opportunity_graph()
def run_opportunity_graph(profile,opportunity,evidence=None,estimated_hours=8.0): return _graph.invoke({"profile":profile,"opportunity":opportunity,"evidence":evidence or [],"estimated_hours":estimated_hours})
