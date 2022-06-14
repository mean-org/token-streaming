#[derive(Debug, PartialEq)]
pub enum StreamStatus {
    Scheduled = 0,
    Running = 1,
    Paused = 2,
}

#[derive(Debug, PartialEq)]
pub enum TreasuryType {
    Opened = 0,
    Locked = 1,
}
