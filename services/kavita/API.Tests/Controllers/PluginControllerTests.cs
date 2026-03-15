using System.Threading.Tasks;
using API.Controllers;
using API.Data;
using API.Data.Repositories;
using API.Services;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;
using NSubstitute;
using Xunit;

namespace API.Tests.Controllers;

public class PluginControllerTests
{
    [Fact]
    public async Task Authenticate_ReturnsUnauthorized_WhenApiKeyDoesNotMatch()
    {
        var unitOfWork = Substitute.For<IUnitOfWork>();
        var userRepository = Substitute.For<IUserRepository>();
        unitOfWork.UserRepository.Returns(userRepository);
        userRepository.GetUserIdByAuthKeyAsync("bad-key").Returns(0);

        var controller = new PluginController(
            unitOfWork,
            Substitute.For<ITokenService>(),
            Substitute.For<ILogger<PluginController>>())
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext()
            }
        };

        var result = await controller.Authenticate("bad-key", "Komf");

        var unauthorized = Assert.IsType<UnauthorizedObjectResult>(result.Result);
        Assert.Equal(401, unauthorized.StatusCode);

        var payload = Assert.IsNotType<string>(unauthorized.Value);
        Assert.Equal(401, (int)payload.GetType().GetProperty("Status")!.GetValue(payload)!);
        Assert.Equal("Unauthorized", (string)payload.GetType().GetProperty("Message")!.GetValue(payload)!);
    }
}
