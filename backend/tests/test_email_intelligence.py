from app.services.email_intelligence import classify_client_email

def test_payment_classification():
    assert classify_client_email("Invoice reminder", "Payment is overdue") == ("payment", "normal")

def test_urgent_project_enquiry():
    assert classify_client_email("Urgent proposal", "Please share the budget and scope today") == ("project_enquiry", "high")

def test_project_update():
    assert classify_client_email("Milestone update", "The delivery is blocked") == ("project_update", "high")

def test_meeting():
    assert classify_client_email("Schedule a call", "Please share your availability") == ("meeting", "normal")

def test_general_fallback():
    assert classify_client_email("Hello", "Thanks for the introduction") == ("general", "normal")
