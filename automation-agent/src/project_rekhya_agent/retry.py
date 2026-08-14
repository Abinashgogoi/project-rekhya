from dataclasses import dataclass


@dataclass
class RetryBudget:
    password_attempts: int = 0
    transient_attempts: int = 0
    final_retry_attempted: bool = False

    def allow_password_retry(self) -> bool:
        if self.password_attempts >= 2:
            return False
        self.password_attempts += 1
        return True

    def allow_transient_retry(self) -> bool:
        if self.transient_attempts >= 4:
            return False
        self.transient_attempts += 1
        return True

    def allow_final_retry(self) -> bool:
        if self.final_retry_attempted:
            return False
        self.final_retry_attempted = True
        return True
