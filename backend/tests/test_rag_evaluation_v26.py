from app.services.rag_evaluation import citation_metrics

def test_citation_metrics_precision_recall_and_f1():
    result = citation_metrics(["a", "b", "c"], ["a", "c", "extra"])
    assert result["matched_count"] == 2
    assert result["precision"] == 0.6667
    assert result["recall"] == 0.6667
    assert result["f1"] == 0.6667

def test_empty_citations_with_expected_evidence_has_zero_scores():
    result = citation_metrics(["a"], [])
    assert result["precision"] == 0
    assert result["recall"] == 0

def test_duplicate_ids_do_not_inflate_metrics():
    result = citation_metrics(["a", "a"], ["a", "a"])
    assert result["expected_count"] == 1
    assert result["cited_count"] == 1
    assert result["f1"] == 1
