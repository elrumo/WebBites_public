const emailTemplate = `

<html lang="en">

<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Your plan has been updated.</title>
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
      <img width="32" src="https://webbites.io/_vercel/image?url=/webbites-logo-medium.png&w=320&q=100" alt="WebBites Logo">
      <p style="padding-left: 8px; margin: 0px; font-weight: 800;">WebBites</p>
    </div>

    <div class="content">
      <h1 style="text-align: center;">
        Your plan has been updated!
      </h1>

      <p>Hello, {{name}} </p>


      <p> 
         <b> Your subscription plan has been successfully updated.</b>
      </p>
      
      <br>

      <small>
        If you have any questions, issues or feedback, feel free to reach out to me personally on X/Twitter at <a href="https://twitter.com/elrumo">@elrumo</a> or leave a comment on the <a href="https://webbites.io/feedback"> feedback page</a>.
      </small>

      <div class="button-wrapper">
        <a class="button" href="https://webbites.io">
          Go to WebBites
        </a>
      </div>
      
      <p>
        Thank you,
      </p>
      
      <br>

      <p>
        <a href="https://twitter.com/elrumo"> Elías </a>
        <br>
        <small> Creator of WebBites</small>
      </p>
      <hr>
    </div>
    <div class="footer">
      &copy; 2024 WebBites. All rights reserved.<br>
      <!-- <a href="https://yourdomain.com/privacy">Privacy Policy</a> | <a href="https://yourdomain.com/terms">Terms of
        Service</a> -->
    </div>
  </div>
</body>

</html>
`

export default emailTemplate
