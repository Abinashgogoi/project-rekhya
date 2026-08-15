from project_rekhya_agent.appium_flow import AppiumFlow


def test_digits_normalizes_formatted_phone_number():
    assert AppiumFlow._digits("+91-075770 59876") == "9107577059876"
