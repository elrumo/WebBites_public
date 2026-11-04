<template>
  <div class="flex w-full max-w-7xl flex-col items-center justify-center p-4 dark overflow-hidden">
    <!-- <div class="py-12 text-3xl font-semibold sm:text-4xl dark:text-white">
      Loved by community <span class="text-4xl"> ❤️</span>
    </div> -->
    <div
      class="relative h-[530px] w-full overflow-hidden rounded-xl border bg-white shadow-lg dark:bg-neutral-800"
    >

      <!-- Center Text -->
      <div
        class="absolute inset-0 z-10 flex flex-col items-center justify-center px-4 text-center dark:text-white"
      >
        <div class="z-20 my-4">
          <NuxtImg
            class="w-28"
            src="/images/WebBites-Icon.png"
          />
        </div>

        <h3 class="mb-2 text-2xl font-bold sm:text-3xl ">What are you waiting for?</h3>
        <p class="mb-8 text-base sm:text-lg">Get started and start building awesome UI 😄</p>
        <UButton
          variant="solid"
          color="neutral"
          size="xl"
          class="rounded-lg shadow-lg"
        >
          Get Started →
        </UButton>
      </div>

      <!-- Tilted Marquees -->
      <div class="absolute inset-0 overflow-hidden">
        <Marquee
          :style="{ transform: 'translateY(-11.5rem) rotate(-16deg)' }"
          class="marquee"
          :pause-on-hover="false"
        >
          <ReviewCard
            v-for="review in firstRow"
            :key="review.username"
            :img="review.img"
            :name="review.name"
            :username="review.username"
            :body="review.body"
          />
        </Marquee>

        <Marquee
          :style="{ transform: 'translateY(1rem) rotate(-16deg)' }"
          reverse
          class="marquee"
          :pause-on-hover="false"
        >
          <ReviewCard
            v-for="review in firstRow"
            :key="review.username"
            :img="review.img"
            :name="review.name"
            :username="review.username"
            :body="review.body"
          />
        </Marquee>

        <Marquee
          :style="{ transform: 'translateY(13.5rem) rotate(-16deg)' }"
          class="marquee"
          :pause-on-hover="false"
        >
          <ReviewCard
            v-for="review in firstRow"
            :key="review.username"
            :img="review.img"
            :name="review.name"
            :username="review.username"
            :body="review.body"
          />
        </Marquee>

        <Marquee
          :style="{ transform: 'translateY(26rem) rotate(-16deg)' }"
          reverse
          class="marquee"
          :pause-on-hover="false"
        >
          <ReviewCard
            v-for="review in firstRow"
            :key="review.username"
            :img="review.img"
            :name="review.name"
            :username="review.username"
            :body="review.body"
          />
        </Marquee>
      </div>

      <!-- Gradient overlay to fade to white at the bottom -->
      <div
        class="pointer-events-none absolute inset-0 bg-gradient-to-t from-white to-transparent dark:from-neutral-900"
      ></div>
    </div>
  </div>
</template>

<script setup lang="ts">
const isDark = computed(() => useColorMode().value == "dark");

// Reviews data
const reviews = [
  {
    name: "kiri",
    username: "@kiruba_selvi6",
    body: "Oooohhh wowww...!!",
    img: "https://inspira-ui.com/images/x-logo.svg",
  },
  {
    name: "Sébastien Chopin",
    username: "@Atinux",
    body: "You ship 🚢",
    img: "https://inspira-ui.com/images/x-logo.svg",
  },
  {
    name: "Mattia Guariglia",
    username: "@matt_guariglia",
    body: "Omg 🥰",
    img: "https://inspira-ui.com/images/x-logo.svg",
  },
  {
    name: "Nelson🐐",
    username: "@Mathiasokafor3",
    body: "Thank you so much for all you do for the Vue/nuxt eco system.",
    img: "https://inspira-ui.com/images/x-logo.svg",
  },
  {
    name: "Premdas Vm",
    username: "@premdasvm",
    body: "Man, this is soo good! I've been jealous of React because their eco-system had Magic UI and other ones like this. Inspira UI is 🔥🙌🏼",
    img: "https://inspira-ui.com/images/x-logo.svg",
  },
  {
    name: "Pierre",
    username: "@PierreHenryBap",
    body: "It looks really awesome! Just noticed it a couple of days ago and I can’t wait to try it out.",
    img: "https://inspira-ui.com/images/x-logo.svg",
  },
  {
    name: "Waldemar Enns",
    username: "@WaldemarEnns",
    body: "Awesome! ⭐️ed it immediately",
    img: "https://inspira-ui.com/images/x-logo.svg",
  },
];

// Rows
const firstRow = ref(reviews);
</script>

<style scoped>
.marquee {
  --duration: 40s;
  position: absolute;
  left: -10%;
  width: 120%;
  padding: 0.5rem 0;
}
</style>
