namespace API.DTOs.Account;

public sealed record NoonaLoginTokenRequestDto
{
    public string Token { get; init; } = string.Empty;
}
