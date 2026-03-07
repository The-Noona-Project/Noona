namespace API.DTOs.Account;

public sealed record NoonaLoginConfigDto
{
    public bool Enabled { get; init; }
    public string MoonBaseUrl { get; init; } = string.Empty;
    public bool DisablePasswordLogin { get; init; }
}
