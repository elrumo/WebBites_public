const emailTemplate = `
<!DOCTYPE html>
<html lang="en">

<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Your feedback has been updated.</title>
  <style>
    html, body {
      font-family: Arial, sans-serif;
      background-color: #222222;
      /* background-color: #F7F7F7; */
      margin: 0;
      padding: 0;
      text-align: center;
    }

    .container {
      max-width: 620px;
      margin: 28px auto;
      background-color: #333333;
      /* background-color: #ffffff; */
      color: white;
      padding: 28px;
      border-radius: 1rem;
      box-shadow: 0 2px 16px rgba(0, 0, 0, 0.05);
    }

    a {
      color: #05D792;
      text-decoration: none;
    }

    hr {
      opacity: 0.1;
    }

    .hero-shot {
      width: 100%;
      height: auto;
      border-radius: 8px;
      border: 1px solid #5f5f5f;
      box-shadow: 0 2px 16px rgba(0, 0, 0, 0.05);
    }

    .button-wrapper {
      padding-top: 18px;
      text-align: center;
    }

    .button {
      text-align: center;
      background-color: #08c586;
      border: none;
      border-radius: 0.5rem;
      font-weight: 800;
      color: white;
      text-align: center;
      text-decoration: none;
      display: inline-block;
      font-size: 16px;
      margin: 4px 2px;
      cursor: pointer;
      color: white;
      text-decoration: none;
      padding: 0.5rem 1rem;
    }

    .header {
      text-align: center;
      margin-bottom: 28px;
      display: flex;
      justify-content: center;
      align-items: center;
    }

    .header img {
      max-width: 100px;
    }

    .content {
      font-size: 16px;
      line-height: 1.5;
    }

    .footer {
      text-align: center;
      font-size: 14px;
      color: #888;
      margin-top: 20px;
    }

  </style>
</head>

<body>
  <div class="container">
    <div class="header">
      <img width="32" src="{{logoUrl}}" alt="{{appName}}">
      <p style="padding-left: 8px; margin: 0px; font-weight: 800;">{{appName}}</p>
    </div>

    <div class="content">
      <h1 style="text-align: center;">
        Your bookmark have been imported!
      </h1>

      <p>Hello, {{name}} </p>


      <p> 
         <b> All your bookmarks have been succesfully imported.</b>
      </p>
      
      <br>


      <div class="button-wrapper">
        <a class="button" href="{{siteUrl}}">
          Go to {{appName}}
        </a>
      </div>
      
      <p>
        Thank you,<br>
        The {{appName}} team
      </p>
      <hr>
    </div>
    <div class="footer">
      &copy; {{year}} {{appName}}<br>
      <!-- <a href="https://yourdomain.com/privacy">Privacy Policy</a> | <a href="https://yourdomain.com/terms">Terms of
        Service</a> -->
    </div>
  </div>
</body>

</html>
`

export default emailTemplate
